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

describe("readImageInfo (header-only size probe)", () => {
  it("reads PNG IHDR", async () => {
    const { readImageInfo } = await import("./photos");
    const b = new Uint8Array(24);
    const v = new DataView(b.buffer);
    v.setUint32(0, 0x89504e47);
    v.setUint32(16, 640);
    v.setUint32(20, 480);
    expect(readImageInfo(b)).toEqual({ width: 640, height: 480, orientation: 1 });
  });

  it("reads JPEG SOF0 size and EXIF orientation, and swaps for upright size", async () => {
    const { readImageInfo, uprightSize } = await import("./photos");
    // SOI, APP1 Exif (big-endian TIFF, 1 IFD entry: orientation = 6), SOF0 4032×3024
    const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
    const app1 = [0xff, 0xe1, 0, exif.length + 2, ...exif];
    const sof = [0xff, 0xc0, 0, 17, 8, 3024 >> 8, 3024 & 255, 4032 >> 8, 4032 & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    const bytes = new Uint8Array([0xff, 0xd8, ...app1, ...sof, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const info = readImageInfo(bytes);
    expect(info).toEqual({ width: 4032, height: 3024, orientation: 6 });
    expect(uprightSize(info!)).toEqual({ width: 3024, height: 4032 });
  });

  it("returns null for unknown formats (e.g. HEIC)", async () => {
    const { readImageInfo } = await import("./photos");
    expect(readImageInfo(new TextEncoder().encode("\0\0\0\x18ftypheic................"))).toBeNull();
  });
});
