import { describe, expect, it } from "vitest";
import { PHOTO_MAX_FILES } from "../../lib/forms/schema";
import { checkFiles, decodeErrorMessage, fitWithin, formatBytes, toJpegName } from "./photos";

const file = (name: string, type: string) => new File([new Uint8Array(10)], name, { type });

describe("checkFiles", () => {
  it("accepts images up to the shared limit and explains the rest", () => {
    const picked = [file("a.jpg", "image/jpeg"), file("b.png", "image/png"), file("c.webp", "image/webp"), file("d.jpg", "image/jpeg")];
    const r = checkFiles(picked, 0, PHOTO_MAX_FILES);
    expect(r.accept.map((f) => f.name)).toEqual(["a.jpg", "b.png", "c.webp"]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/up to 3 photos/);
  });

  it("counts photos that are already attached", () => {
    const r = checkFiles([file("a.jpg", "image/jpeg"), file("b.jpg", "image/jpeg")], 2, 3);
    expect(r.accept).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
  });

  it("rejects non-images but lets HEIC through (decoding decides later)", () => {
    const r = checkFiles([file("notes.pdf", "application/pdf"), file("IMG_1.HEIC", "")], 0, 3);
    expect(r.accept.map((f) => f.name)).toEqual(["IMG_1.HEIC"]);
    expect(r.errors[0]).toMatch(/isn't an image/);
  });
});

describe("fitWithin", () => {
  it("scales the long edge down to 1600 and keeps the ratio", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });
  it("never upscales", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("helpers", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("1 KB");
    expect(formatBytes(190_000)).toBe("186 KB");
    expect(formatBytes(2_500_000)).toBe("2.4 MB");
  });
  it("renames to .jpg", () => {
    expect(toJpegName("IMG_0042.HEIC")).toBe("IMG_0042.jpg");
    expect(toJpegName("board")).toBe("board.jpg");
  });
  it("gives HEIC-specific help", () => {
    expect(decodeErrorMessage("IMG_1.heic")).toMatch(/HEIC/);
    expect(decodeErrorMessage("x.png")).toMatch(/Couldn't read/);
  });
});
