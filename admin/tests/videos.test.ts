/**
 * Video admin handlers on a throwaway data copy (see harness.ts): guards, every operation, the
 * photo-poster link, and a real upload (GPS-tagged clip → background job → clean public/media file).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyCleanVideo } from "../../scripts/lib/process-video.mjs";
import { formatVideosJson } from "../../src/lib/gallery/video-records.ts";
import type { AdminState, ApiError, VideoJob } from "../lib/types.ts";
import { makeClip } from "./clips.ts";
import { idsOf, initialVideos, PORT, TOKEN, useTestAdmin } from "./harness.ts";

const admin = useTestAdmin();
const { send, post } = admin;

const addVideo = async () => {
  // a second gwii video + one in gboy, so ordering/moving has something to do
  const videos = [
    ...initialVideos,
    { id: 2, file: "v0002.mp4", project: "gwii", title: "Second" },
    { id: 3, file: "v0003.mp4", project: "gboy", title: "Third" },
  ];
  await fs.writeFile(admin.paths.videosJson, formatVideosJson(videos));
  for (const v of videos) await fs.writeFile(path.join(admin.paths.mediaDir, v.file), `video ${v.id}`);
  return fs.readFile(admin.paths.videosJson, "utf8");
};

async function uploadClip(
  file: string,
  query: Record<string, string>,
  options: { token?: string | null; origin?: string | null; contentType?: string } = {},
) {
  const search = new URLSearchParams(query).toString();
  return send(`/api/videos/upload?${search}`, {
    method: "POST",
    body: await fs.readFile(file),
    contentType: options.contentType ?? "video/quicktime",
    ...options,
  });
}

async function waitForJob(id: string): Promise<VideoJob> {
  for (let i = 0; i < 600; i++) {
    const job = (await (await send(`/api/videos/jobs/${id}`)).json()) as VideoJob;
    if (job.state === "done" || job.state === "error") return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("job did not finish");
}

describe("video guards", () => {
  it("needs the token (header, or ?t= for the preview player), the right Host, and Origin on changes", async () => {
    expect((await send("/api/videos/jobs/aaaaaaaaaaaaaaaa", { token: null })).status).toBe(401);
    expect((await send("/api/video/1", { token: null })).status).toBe(401);
    expect((await send(`/api/video/1?t=${TOKEN}`, { token: null })).status).toBe(200);
    expect((await send("/api/video/1", { host: "evil.example:4400" })).status).toBe(403);
    expect((await post("/api/videos/delete", { ids: [1] }, { origin: "http://evil.example" })).status).toBe(
      403,
    );
    expect((await post("/api/videos/delete", { ids: [1] }, { origin: null })).status).toBe(403);
    expect((await send(`/api/video/1`, { host: `localhost:${PORT}` })).status).toBe(200);
    expect(JSON.parse(await fs.readFile(admin.paths.videosJson, "utf8"))).toEqual(initialVideos);
  });

  it("validates ids, projects, titles and posters", async () => {
    expect((await post("/api/videos/delete", { ids: ["1"] })).status).toBe(400);
    expect((await post("/api/videos/move", { ids: [1], project: "../etc" })).status).toBe(400);
    expect((await post("/api/videos/update", { id: 1 })).status).toBe(400);
    expect((await post("/api/videos/update", { id: 1, title: "x".repeat(121) })).status).toBe(400);
    expect((await post("/api/videos/update", { id: 1, posterId: 20 })).status).toBe(400); // photo from gboy
    expect((await post("/api/videos/update", { id: 99, title: "x" })).status).toBe(404);
    expect((await send("/api/video/9999")).status).toBe(404);
    expect((await send("/api/videos/jobs/..%2F..%2Fx")).status).toBe(404);
  });

  it("serves previews with byte ranges", async () => {
    const full = await send("/api/video/1");
    expect([full.status, full.headers.get("accept-ranges"), await full.text()]).toEqual([
      200,
      "bytes",
      "not really a video",
    ]);
    const ranged = await admin.sendRaw(
      new Request(`http://127.0.0.1:${PORT}/api/video/1`, {
        headers: { host: `127.0.0.1:${PORT}`, "x-admin-token": TOKEN, range: "bytes=4-9" },
      }),
    );
    expect([ranged.status, ranged.headers.get("content-range"), await ranged.text()]).toEqual([
      206,
      "bytes 4-9/18",
      "really",
    ]);
  });
});

describe("video operations", () => {
  it("reorders, moves across projects, and undoes with arrange (identical bytes)", async () => {
    const before = await addVideo();
    await post("/api/videos/move", { ids: [2], project: "gwii", beforeId: 1 });
    expect(idsOf(await admin.readVideos(), "gwii")).toEqual([2, 1]);
    await post("/api/videos/move", { ids: [1], project: "gboy", beforeId: null });
    expect(idsOf(await admin.readVideos(), "gboy")).toEqual([3, 1]);
    const undo = await post("/api/videos/arrange", { layout: { gwii: [1, 2], gboy: [3] } });
    expect(undo.status).toBe(200);
    expect(await fs.readFile(admin.paths.videosJson, "utf8")).toBe(before);
  });

  it("retitles and switches the poster to another project photo or back to auto", async () => {
    let state = (await (
      await post("/api/videos/update", { id: 1, title: "  New   title " })
    ).json()) as AdminState;
    expect(state.videos[0].title).toBe("New title");
    state = (await (await post("/api/videos/update", { id: 1, posterId: 12 })).json()) as AdminState;
    expect([state.videos[0].posterId, state.videos[0].posterThumbId]).toEqual([12, 12]);
    state = (await (await post("/api/videos/update", { id: 1, posterId: null })).json()) as AdminState;
    expect(state.videos[0].posterId).toBeUndefined();
    expect(state.videos[0].posterThumbId).toBe(10); // the project cover
  });

  it("deletes to the trash (file moves too) and restores byte-for-byte", async () => {
    const before = await addVideo();
    const deleted = (await (await post("/api/videos/delete", { ids: [2, 1] })).json()) as AdminState;
    expect(deleted.videos.map((v) => v.id)).toEqual([3]);
    expect(deleted.videoTrash.map((v) => v.id).sort()).toEqual([1, 2]);
    await expect(fs.access(path.join(admin.paths.trashDir, "legacy-clip.mp4"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(admin.paths.mediaDir, "legacy-clip.mp4"))).rejects.toThrow();
    expect((await send("/api/video/1")).status).toBe(200); // trash preview

    expect((await post("/api/videos/restore", { ids: [1, 2] })).status).toBe(200);
    expect(await fs.readFile(admin.paths.videosJson, "utf8")).toBe(before);
    await expect(fs.access(path.join(admin.paths.mediaDir, "legacy-clip.mp4"))).resolves.toBeUndefined();
    expect((await post("/api/videos/restore", { ids: [1] })).status).toBe(404);
  });

  it("deleting a poster photo switches the video to auto, and restoring the photo brings it back", async () => {
    const before = await fs.readFile(admin.paths.videosJson, "utf8");
    await post("/api/delete", { ids: [11] });
    expect((await admin.readVideos())[0].posterId).toBeUndefined();
    await post("/api/restore", { ids: [11] });
    expect(await fs.readFile(admin.paths.videosJson, "utf8")).toBe(before);
  });
});

describe("video upload", () => {
  it("processes a GPS-tagged clip in the background into a clean v<id>.mp4 at the end of the project", async () => {
    const clip = path.join(admin.root, "IMG_0042.MOV");
    await makeClip(clip, { rotation: 90 });
    await fs.writeFile(path.join(admin.paths.mediaDir, "v0007.mp4"), "old"); // ids are never reused
    const res = await uploadClip(clip, { project: "gwii", title: " Board close-up ", name: "IMG_0042.MOV" });
    expect(res.status).toBe(202);
    const job = await waitForJob(((await res.json()) as VideoJob).id);
    expect(job).toMatchObject({ state: "done", fileName: "IMG_0042.MOV", project: "gwii" });
    expect(job.video).toMatchObject({ id: 8, file: "v0008.mp4", title: "Board close-up", posterThumbId: 10 });

    expect(idsOf(await admin.readVideos(), "gwii")).toEqual([1, 8]);
    const saved = path.join(admin.paths.mediaDir, "v0008.mp4");
    expect(await verifyCleanVideo(saved)).toEqual({ ok: true, problems: [] });
    expect((await fs.readFile(saved)).toString("latin1")).not.toContain("+47.6062");
    expect(await fs.readdir(admin.paths.uploadDir)).toEqual([]); // temp files cleaned up
  }, 60_000);

  it("reports unusable files through the job, and refuses bad requests up front", async () => {
    const fake = path.join(admin.root, "fake.mov");
    await fs.writeFile(fake, "not a video at all");
    const res = await uploadClip(fake, { project: "gwii", title: "Fake" });
    const job = await waitForJob(((await res.json()) as VideoJob).id);
    expect(job.state).toBe("error");
    expect(job.message).toMatch(/isn't a video we can read/);

    const ok = { project: "gwii", title: "T", name: "a.mov" };
    expect((await uploadClip(fake, ok, { token: null })).status).toBe(401);
    expect((await uploadClip(fake, ok, { origin: "http://evil.example" })).status).toBe(403);
    expect((await uploadClip(fake, { ...ok, project: "nope" })).status).toBe(400);
    expect((await uploadClip(fake, { ...ok, title: "" })).status).toBe(400);
    const wrongType = await uploadClip(fake, { ...ok, name: "a.txt" }, { contentType: "text/plain" });
    expect(wrongType.status).toBe(415);
    expect(((await wrongType.json()) as ApiError).message).toMatch(/MP4, MOV or WebM/);
    // A declared size over 500 MB is refused before reading anything.
    const tooBig = await admin.sendRaw(
      new Request(`http://127.0.0.1:${PORT}/api/videos/upload?project=gwii&title=T`, {
        method: "POST",
        headers: {
          host: `127.0.0.1:${PORT}`,
          origin: `http://127.0.0.1:${PORT}`,
          "x-admin-token": TOKEN,
          "content-type": "video/mp4",
          "content-length": String(600 * 2 ** 20),
        },
        body: "x",
      }),
    );
    expect(tooBig.status).toBe(413);
    expect(await admin.readVideos()).toEqual(initialVideos);
  }, 60_000);
});
