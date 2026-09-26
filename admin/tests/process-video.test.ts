/**
 * scripts/lib/process-video.mjs on real (tiny, generated) clips: metadata including GPS must be
 * gone, output ≤ 24 MiB with faststart, rotation right, and bad inputs refused clearly.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MAX_OUTPUT_BYTES,
  parseBoxes,
  probeVideo,
  processVideo,
  UnsupportedVideoError,
  verifyCleanVideo,
} from "../../scripts/lib/process-video.mjs";
import { makeClip } from "./clips.ts";

let dir: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mod-labs-video-"));
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const at = (name: string) => path.join(dir, name);

/** Every byte-level trace of the phone metadata the clips were made with. */
async function leaks(file: string) {
  const text = (await fs.readFile(file)).toString("latin1");
  return ["+47.6062", "ISO6709", "com.apple", "Private title", "2025-06-01"].filter((n) => text.includes(n));
}

describe("processVideo", () => {
  it("stream-copies an H.264/AAC phone clip, dropping GPS, dates and titles, with faststart", async () => {
    await makeClip(at("phone.mov"), { rotation: -90 });
    const before = await probeVideo(at("phone.mov"));
    expect(before.formatTags).toEqual(
      expect.arrayContaining(["location", "com.apple.quicktime.location.ISO6709", "creation_time"]),
    );
    expect(await leaks(at("phone.mov"))).not.toEqual([]);

    const result = await processVideo(at("phone.mov"), at("phone.mp4"));
    expect(result.mode).toBe("copy");
    expect(result.bytes).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    expect([result.width, result.height]).toEqual([240, 320]); // shown upright (rotation flag kept)
    expect(await leaks(at("phone.mp4"))).toEqual([]);
    expect(await verifyCleanVideo(at("phone.mp4"))).toEqual({ ok: true, problems: [] });

    const top = parseBoxes(await fs.readFile(at("phone.mp4"))).map((b) => b.type);
    expect(top.indexOf("moov")).toBeLessThan(top.indexOf("mdat")); // faststart
    const after = await probeVideo(at("phone.mp4"));
    expect(after.formatTags).toEqual(["major_brand", "minor_version", "compatible_brands"]);
    expect(Math.abs(after.video?.rotation ?? 0)).toBe(90);
  }, 60_000);

  it("transcodes other codecs to H.264/AAC ≤1080px, also without metadata", async () => {
    await makeClip(at("clip.webm"), { codec: "vp9", size: "1920x1080" });
    const result = await processVideo(at("clip.webm"), at("clip.mp4"));
    expect(result.mode).toBe("transcode");
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1080);
    const info = await probeVideo(at("clip.mp4"));
    expect([info.video?.codec, info.audio?.codec, info.video?.pixFmt]).toEqual(["h264", "aac", "yuv420p"]);
    expect((await verifyCleanVideo(at("clip.mp4"))).ok).toBe(true);
    expect(await leaks(at("clip.mp4"))).toEqual([]);
  }, 60_000);

  it("refuses videos over 3 minutes and files that aren't videos", async () => {
    await makeClip(at("long.mp4"), { seconds: 181, size: "64x64", withPhoneMetadata: false });
    await expect(processVideo(at("long.mp4"), at("long-out.mp4"))).rejects.toThrow(
      /3:01 long. Videos can be up to 3 minutes/,
    );
    await fs.writeFile(at("notes.mov"), "definitely not a video");
    await expect(processVideo(at("notes.mov"), at("notes-out.mp4"))).rejects.toBeInstanceOf(
      UnsupportedVideoError,
    );
  }, 60_000);
});

describe("verifyCleanVideo", () => {
  it("flags a file that still carries location metadata", async () => {
    await makeClip(at("dirty.mp4"));
    const check = await verifyCleanVideo(at("dirty.mp4"));
    expect(check.ok).toBe(false);
    expect(check.problems.join(" ")).toMatch(/metadata box|location|container tags|keeps a date/);
  }, 60_000);
});
