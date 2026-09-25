// Shared gallery photo processing, used by the photo admin (uploads) and the one-time
// id migration (metadata verification). One place decides what a published photo looks like:
// EXIF rotation baked in, long edge <= 2048px, JPEG q82 (mozjpeg), and NO metadata at all
// (sharp drops EXIF/XMP/IPTC/GPS unless .keepMetadata()/.withMetadata() is called).
import sharp from "sharp";

export const MAX_EDGE_PX = 2048;
export const JPEG_QUALITY = 82;
/** Refuse absurd images before decoding them fully (decompression-bomb guard). */
export const MAX_INPUT_PIXELS = 120_000_000;
/** Formats sharp can decode here and that we accept as uploads. */
export const ACCEPTED_FORMATS = ["jpeg", "png", "webp", "avif", "tiff"];

export class UnsupportedPhotoError extends Error {
  name = "UnsupportedPhotoError";
}

/**
 * HEIC/HEIF (iPhone default) is an ISO-BMFF file with an `ftyp` box. The prebuilt sharp has no
 * HEVC decoder, so we recognise it up front to give the owner a useful message.
 * @param {Uint8Array} head the first bytes of the file
 */
export function looksLikeHeic(head) {
  if (head.length < 12) return false;
  const box = String.fromCharCode(...head.subarray(4, 8));
  const brand = String.fromCharCode(...head.subarray(8, 12));
  return box === "ftyp" && ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand);
}

const HEIC_MESSAGE =
  "HEIC (iPhone) photos can't be read here. On the iPhone, choose Settings → Camera → Formats → " +
  "Most Compatible, or export/share the photo as JPEG, then upload it again.";

/**
 * Decode any accepted image and re-encode it as a clean gallery JPEG.
 * @param {Buffer} input
 * @returns {Promise<{ data: Buffer; width: number; height: number }>}
 * @throws {UnsupportedPhotoError} when the file isn't an image we can read
 */
export async function processPhoto(input) {
  if (looksLikeHeic(input)) throw new UnsupportedPhotoError(HEIC_MESSAGE);

  /** @type {import("sharp").Metadata} */
  let meta;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new UnsupportedPhotoError("This file isn't a photo we can read. Use a JPEG, PNG or WebP image.");
  }
  if (!meta.format || !ACCEPTED_FORMATS.includes(meta.format)) {
    throw new UnsupportedPhotoError(
      `${String(meta.format ?? "This").toUpperCase()} files aren't supported. Use a JPEG, PNG or WebP image.`,
    );
  }

  try {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new UnsupportedPhotoError(
      "This photo looks damaged and couldn't be processed. Try exporting it again.",
    );
  }
}

/**
 * True when the image still carries any EXIF/XMP/IPTC block (GPS lives in EXIF).
 * @param {string | Buffer} input file path or bytes
 */
export async function hasMetadata(input) {
  const meta = await sharp(input).metadata();
  return Boolean(meta.exif || meta.xmp || meta.iptc);
}
