/**
 * Photo admin handlers, end to end on a throwaway copy of the data layout (see harness.ts):
 * guards, every photo operation, and photo upload processing.
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { formatPhotosJson } from "../../src/lib/gallery/records.ts";
import { hasMetadata } from "../../scripts/lib/process-photo.mjs";
import type { AdminState, ApiError, UploadResult } from "../lib/types.ts";
import { idsOf, initialPhotos as initial, jpeg, PORT, TOKEN, useTestAdmin } from "./harness.ts";

const admin = useTestAdmin();
const { send, post } = admin;
const readList = () => admin.readPhotos();

function uploadForm(file: Blob, name: string, project = "gboy") {
  const form = new FormData();
  form.append("project", project);
  form.append("file", file, name);
  return form;
}

describe("guards", () => {
  it("serves the page with the token and strict security headers", async () => {
    const res = await send("/", { token: null });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`content="${TOKEN}"`);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("rejects API calls without the right token (401)", async () => {
    expect((await send("/api/state", { token: null })).status).toBe(401);
    expect((await send("/api/state", { token: "wrong" })).status).toBe(401);
    expect((await send("/api/thumb/10")).status).toBe(200); // header token
    expect((await send(`/api/thumb/10?t=${TOKEN}`, { token: null })).status).toBe(200); // <img> query token
    expect((await send("/api/state?t=" + TOKEN, { token: null })).status).toBe(401); // query token is thumbs-only
  });

  it("rejects any other Host, including the page itself (DNS rebinding)", async () => {
    for (const host of ["evil.example:4400", "127.0.0.1:9999", "127.0.0.1"]) {
      expect((await send("/", { host })).status, host).toBe(403);
      expect((await send("/api/state", { host })).status, host).toBe(403);
    }
    expect((await send("/api/state", { host: `localhost:${PORT}` })).status).toBe(200);
  });

  it("rejects changes without a same-origin Origin (403) and leaves the data alone", async () => {
    const body = { ids: [12], project: "gwii", beforeId: 10 };
    expect((await post("/api/move", body, { origin: null })).status).toBe(403);
    expect((await post("/api/move", body, { origin: "http://evil.example" })).status).toBe(403);
    expect(await readList()).toEqual(initial);
  });

  it("refuses other methods, unknown routes, bad JSON and bad input", async () => {
    expect((await send("/api/state", { method: "PUT" })).status).toBe(405);
    expect((await send("/api/nope")).status).toBe(404);
    expect((await send("/api/reorder", { json: {} })).status).toBe(404); // replaced by /api/arrange
    expect((await send("/../src/data/photos.json", { token: null })).status).toBe(404);
    expect((await send("/api/move", { body: "{}" })).status).toBe(415);
    expect((await post("/api/delete", { ids: ["10"] })).status).toBe(400);
    expect((await post("/api/delete", { ids: [1.5] })).status).toBe(400);
    expect((await post("/api/delete", { ids: [] })).status).toBe(400);
    expect((await post("/api/delete", { ids: [10, 10] })).status).toBe(400);
    expect((await post("/api/move", { ids: [10], project: "../../etc" })).status).toBe(400);
    expect((await post("/api/arrange", { layout: { "../x": [10] } })).status).toBe(400);
    expect((await post("/api/delete", { ids: "x".repeat(70_000) })).status).toBe(413);
    expect(await readList()).toEqual(initial);
  });
});

describe("operations", () => {
  it("returns the state grouped data the UI needs", async () => {
    const state = (await (await send("/api/state")).json()) as AdminState;
    expect(state.photos.map((p) => p.id)).toEqual([10, 11, 12, 20]);
    expect(state.photos[0].category).toBe("custom");
    expect(state.projects.some((p) => p.slug === "gwii")).toBe(true);
    expect(state.pending).toEqual({ count: 0 });
  });

  it("moves several photos across projects in one write, then undoes it with arrange", async () => {
    const before = await fs.readFile(admin.paths.photosJson, "utf8");
    const res = await post("/api/move", { ids: [20, 11], project: "halo-xbox", beforeId: null });
    expect(res.status).toBe(200);
    const list = await readList();
    expect(idsOf(list, "halo-xbox")).toEqual([11, 20]); // current relative order
    expect(idsOf(list, "gwii")).toEqual([10, 12]);
    expect(idsOf(list, "gboy")).toEqual([]);

    const undo = await post("/api/arrange", { layout: { gwii: [10, 11, 12], gboy: [20], "halo-xbox": [] } });
    expect(undo.status).toBe(200);
    expect(await fs.readFile(admin.paths.photosJson, "utf8")).toBe(before);
  });

  it("places photos before a drop target, and refuses stale targets and layouts with 409", async () => {
    expect((await post("/api/move", { ids: [12], project: "gwii", beforeId: 10 })).status).toBe(200);
    expect(idsOf(await readList(), "gwii")).toEqual([12, 10, 11]);
    expect((await post("/api/move", { ids: [10], project: "gboy", beforeId: 11 })).status).toBe(409);
    expect((await post("/api/arrange", { layout: { gwii: [10, 11] } })).status).toBe(409);
  });

  it("is all-or-nothing: one unknown id changes nothing", async () => {
    expect((await post("/api/move", { ids: [10, 999], project: "gboy", beforeId: null })).status).toBe(404);
    expect((await post("/api/delete", { ids: [10, 999] })).status).toBe(404);
    expect(await readList()).toEqual(initial);
    expect(await fs.readdir(admin.paths.photosDir)).toHaveLength(4);
  });

  it("deletes a batch to the trash and restores it byte-for-byte", async () => {
    const before = await fs.readFile(admin.paths.photosJson, "utf8");
    const deleted = (await (await post("/api/delete", { ids: [11, 20, 10] })).json()) as AdminState;
    expect(deleted.photos.map((p) => p.id)).toEqual([12]);
    expect(deleted.trash.map((t) => t.id).sort()).toEqual([10, 11, 20]);
    for (const f of ["p0010.jpg", "p0011.jpg", "p0020.jpg"]) {
      await expect(fs.access(path.join(admin.paths.trashDir, f))).resolves.toBeUndefined();
    }
    expect((await send("/api/thumb/11")).status).toBe(200); // trash view thumbnails

    expect((await post("/api/restore", { ids: [10, 11, 20] })).status).toBe(200);
    expect(await fs.readFile(admin.paths.photosJson, "utf8")).toBe(before);
    expect(JSON.parse(await fs.readFile(admin.paths.trashManifest, "utf8"))).toEqual([]);
    expect((await post("/api/restore", { ids: [11] })).status).toBe(404);
  });

  it("restores part of a batch, and reads trash entries written by the previous version", async () => {
    await post("/api/delete", { ids: [10, 11] });
    const manifest = JSON.parse(await fs.readFile(admin.paths.trashManifest, "utf8"));
    expect(Object.keys(manifest[0]).sort()).toEqual(["afterId", "deletedAt", "index", "record"]);
    expect((await post("/api/restore", { ids: [11] })).status).toBe(200);
    expect(idsOf(await readList(), "gwii")).toEqual([11, 12]);
    expect((await post("/api/restore", { ids: [10] })).status).toBe(200);
    expect(idsOf(await readList(), "gwii")).toEqual([10, 11, 12]);
  });
});

describe("upload", () => {
  it("strips EXIF/GPS, bakes rotation, caps the size, and never reuses an id", async () => {
    const withGps = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#f0a" } })
      .jpeg()
      .withMetadata({ orientation: 6 }) // phone held sideways
      .withExif({ IFD0: { Make: "TestCam" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "47/1 36/1 0/1" } })
      .toBuffer();
    expect(await hasMetadata(withGps)).toBe(true);

    await post("/api/delete", { ids: [20] }); // highest id is now only in the trash
    const res = await send("/api/upload", {
      body: uploadForm(new Blob([withGps], { type: "image/jpeg" }), "IMG_0001.JPG"),
    });
    expect(res.status).toBe(200);
    const { photo, state } = (await res.json()) as UploadResult;

    expect(photo.id).toBe(21);
    expect(photo.file).toBe("photos/p0021.jpg");
    expect([photo.width, photo.height]).toEqual([1024, 2048]); // rotated upright, long edge 2048
    expect(state.photos.at(-1)?.id).toBe(21);
    const saved = path.join(admin.paths.photosDir, "p0021.jpg");
    expect(await hasMetadata(saved)).toBe(false);
    expect(await sharp(saved).metadata()).toMatchObject({ format: "jpeg", width: 1024, height: 2048 });
    expect(await fs.readFile(admin.paths.photosJson, "utf8")).toBe(formatPhotosJson(await readList()));
  });

  it("gives clear errors for HEIC, non-images and missing input", async () => {
    const heic = new Uint8Array([
      0,
      0,
      0,
      24,
      ...new TextEncoder().encode("ftypheic"),
      ...new Uint8Array(32),
    ]);
    const heicRes = await send("/api/upload", {
      body: uploadForm(new Blob([heic], { type: "image/heic" }), "IMG.HEIC"),
    });
    expect(heicRes.status).toBe(415);
    expect(((await heicRes.json()) as ApiError).message).toMatch(/HEIC.*Most Compatible/);

    const text = await send("/api/upload", {
      body: uploadForm(new Blob(["hello"], { type: "text/plain" }), "notes.txt"),
    });
    expect(text.status).toBe(415);
    expect(((await text.json()) as ApiError).message).toMatch(/isn't an image/);

    const fake = await send("/api/upload", {
      body: uploadForm(new Blob(["not a jpeg"], { type: "image/jpeg" }), "fake.jpg"),
    });
    expect(fake.status).toBe(415);
    expect(((await fake.json()) as ApiError).message).toMatch(/isn.t a photo we can read/);

    const noProject = await send("/api/upload", {
      body: uploadForm(new Blob([await jpeg()], { type: "image/jpeg" }), "a.jpg", "nope"),
    });
    expect(noProject.status).toBe(400);

    const form = new FormData();
    form.append("project", "gwii");
    expect((await send("/api/upload", { body: form })).status).toBe(400);
    expect(await readList()).toEqual(initial);
  });

  it("requires the token and a same-origin Origin", async () => {
    const body = () => uploadForm(new Blob([new Uint8Array(10)], { type: "image/jpeg" }), "a.jpg");
    expect((await send("/api/upload", { body: body(), token: null })).status).toBe(401);
    expect((await send("/api/upload", { body: body(), origin: "http://evil.example" })).status).toBe(403);
  });
});
