import { describe, expect, it } from "vitest";
import {
  cleanTitle,
  formatVideosJson,
  isSafeVideoFile,
  validateVideoRecords,
  videoFileForId,
  type VideoRecord,
} from "./video-records";

const context = {
  knownProjects: ["gwii", "gboy"],
  photoIds: [5, 6],
  fileExists: (f: string) => f !== "missing.mp4",
};
const video = (over: Partial<VideoRecord> = {}): VideoRecord => ({
  id: 1,
  file: "v0001.mp4",
  project: "gwii",
  title: "A clip",
  ...over,
});

describe("video file names", () => {
  it("names uploads by id and only accepts plain .mp4 names", () => {
    expect(videoFileForId(7)).toBe("v0007.mp4");
    expect(isSafeVideoFile("halo-xbox.mp4")).toBe(true);
    for (const bad of ["../x.mp4", "a/b.mp4", ".hidden.mp4", "x.mov", "x..mp4", "", 5])
      expect(isSafeVideoFile(bad)).toBe(false);
  });
});

describe("cleanTitle", () => {
  it("trims, collapses spaces and enforces 1–120 characters without control characters", () => {
    expect(cleanTitle("  RGB   lighting ")).toEqual({ ok: true, title: "RGB lighting" });
    expect(cleanTitle("   ").ok).toBe(false);
    expect(cleanTitle("x".repeat(121)).ok).toBe(false);
    expect(cleanTitle("x".repeat(120)).ok).toBe(true);
    expect(cleanTitle("bad\u0007bell").ok).toBe(false);
    expect(cleanTitle(42).ok).toBe(false);
  });
});

describe("validateVideoRecords", () => {
  it("accepts valid data and normalizes key order", () => {
    const result = validateVideoRecords(
      [{ posterId: 5, title: "A clip", project: "gwii", file: "halo-xbox.mp4", id: 3, extra: 1 }],
      context,
    );
    expect(result).toEqual({
      ok: true,
      records: [{ id: 3, file: "halo-xbox.mp4", project: "gwii", title: "A clip", posterId: 5 }],
    });
  });

  it("reports every problem", () => {
    const result = validateVideoRecords(
      [
        video(),
        video({ file: "v0002.mp4" }), // duplicate id
        video({ id: 3, file: "v0001.mp4" }), // duplicate file
        video({ id: 4, file: "missing.mp4" }),
        video({ id: 5, file: "../x.mp4" }),
        video({ id: 6, file: "v0006.mp4", project: "nope" }),
        video({ id: 7, file: "v0007.mp4", title: "" }),
        video({ id: 8, file: "v0008.mp4", posterId: 999 }),
        video({ id: 9, file: "v0009.mp4", title: " padded " }),
      ],
      context,
    );
    expect(result.ok).toBe(false);
    const text = result.ok ? "" : result.problems.join("\n");
    for (const expected of [
      /id 1\): duplicate id/,
      /v0001.mp4 is used twice/,
      /missing.mp4 does not exist/,
      /plain .mp4 name/,
      /unknown project "nope"/,
      /Give the video a title/,
      /posterId 999/,
      /extra spaces/,
    ]) {
      expect(text).toMatch(expected);
    }
  });

  it("rejects non-arrays", () => {
    expect(validateVideoRecords({}, context).ok).toBe(false);
  });
});

describe("formatVideosJson", () => {
  it("writes one video per line and omits an absent poster", () => {
    expect(formatVideosJson([video(), video({ id: 2, file: "v0002.mp4", posterId: 6 })])).toBe(
      '[\n  {"id":1,"file":"v0001.mp4","project":"gwii","title":"A clip"},\n' +
        '  {"id":2,"file":"v0002.mp4","project":"gwii","title":"A clip","posterId":6}\n]\n',
    );
    expect(formatVideosJson([])).toBe("[]\n");
  });
});
