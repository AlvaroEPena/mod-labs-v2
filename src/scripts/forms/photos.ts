/**
 * Photo selection rules + client-side downscaling for the quote form.
 * Every accepted photo is re-encoded through a canvas to a ≤1600px JPEG (≈0.82 quality), which
 * keeps uploads small for the Worker and strips EXIF/GPS metadata.
 * Limits (PHOTO_MAX_FILES / PHOTO_MAX_BYTES from the shared schema) are passed in by the caller so
 * this module never pulls zod into the page bundle.
 */

export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.82;

export type FileCheck = { accept: File[]; errors: string[] };

const looksLikeImage = (f: File) => f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp|gif|avif)$/i.test(f.name);

/** Decide which newly picked files can be added, given how many are already attached. */
export function checkFiles(picked: File[], alreadyAttached: number, max: number): FileCheck {
  const errors: string[] = [];
  const accept: File[] = [];
  for (const f of picked) {
    if (!looksLikeImage(f)) {
      errors.push(`"${f.name}" isn't an image. Please attach photos only.`);
      continue;
    }
    if (alreadyAttached + accept.length >= max) {
      errors.push(`You can attach up to ${max} photos. "${f.name}" wasn't added.`);
      continue;
    }
    accept.push(f);
  }
  return { accept, errors };
}

/** Target dimensions that fit inside maxEdge×maxEdge, never upscaling. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export const formatBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export const toJpegName = (name: string) => `${name.replace(/\.[^.]+$/, "") || "photo"}.jpg`;

export class DecodeError extends Error {}

export const decodeErrorMessage = (name: string) =>
  /\.(heic|heif)$/i.test(name)
    ? `"${name}" is an iPhone HEIC photo, which this browser can't read. Try Safari, or set iPhone Camera › Formats to "Most Compatible", or send a screenshot of it.`
    : `Couldn't read "${name}". Try a JPEG or PNG version of that photo.`;


export type ImageInfo = { width: number; height: number; /** EXIF orientation 1–8 (JPEG only; 1 = upright) */ orientation: number };

/**
 * Read pixel dimensions (and JPEG EXIF orientation) from the first bytes of a JPEG, PNG or WebP
 * without decoding it. Returns null for anything else (e.g. HEIC) or a truncated header.
 */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes.length;
  // PNG: IHDR is the first chunk
  if (n >= 24 && v.getUint32(0) === 0x89504e47) return { width: v.getUint32(16), height: v.getUint32(20), orientation: 1 };
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X
  if (n >= 30 && v.getUint32(0) === 0x52494646 && v.getUint32(8) === 0x57454250) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === "VP8X") return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)), orientation: 1 };
    if (chunk === "VP8L") {
      const b = v.getUint32(21, true);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, orientation: 1 };
    }
    if (chunk === "VP8 ") return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff, orientation: 1 };
    return null;
  }
  // JPEG: walk markers; APP1 Exif for orientation, SOFn for size
  if (n >= 4 && v.getUint16(0) === 0xffd8) {
    let orientation = 1;
    let p = 2;
    while (p + 9 < n) {
      if (bytes[p] !== 0xff) return null;
      const marker = bytes[p + 1];
      if (marker === 0xff) {
        p++;
        continue;
      }
      const len = v.getUint16(p + 2);
      if (marker === 0xe1 && p + 10 + 8 < n && v.getUint32(p + 4) === 0x45786966) {
        orientation = exifOrientation(v, p + 10, Math.min(n, p + 2 + len)) ?? orientation;
      }
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: v.getUint16(p + 5), width: v.getUint16(p + 7), orientation };
      p += 2 + len;
    }
  }
  return null;
}

function exifOrientation(v: DataView, tiff: number, end: number): number | null {
  if (tiff + 8 > end) return null;
  const le = v.getUint16(tiff) === 0x4949;
  const ifd = tiff + v.getUint32(tiff + 4, le);
  if (ifd + 2 > end) return null;
  const count = v.getUint16(ifd, le);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) return null;
    if (v.getUint16(e, le) === 0x0112) {
      const o = v.getUint16(e + 8, le);
      return o >= 1 && o <= 8 ? o : null;
    }
  }
  return null;
}

/** Upright (display) size: EXIF orientations 5–8 swap width and height. */
export const uprightSize = (i: ImageInfo) => (i.orientation >= 5 ? { width: i.height, height: i.width } : { width: i.width, height: i.height });

/* ---------- browser-only below ---------- */

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

const HEADER_BYTES = 256 * 1024;
const ratioOff = (w: number, h: number, tw: number, th: number) => Math.abs(w / h - tw / th) / (tw / th) > 0.02;

/**
 * Decode at (or near) the target size so phones never hold a full 12 MP bitmap:
 * createImageBitmap with resizeWidth/resizeHeight where supported, full decode otherwise,
 * and an <img> fallback for older Safari.
 */
async function decode(file: File): Promise<Decoded> {
  if ("createImageBitmap" in window) {
    let target: { width: number; height: number } | null = null;
    try {
      const info = readImageInfo(new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer()));
      if (info) target = fitWithin(uprightSize(info).width, uprightSize(info).height);
    } catch {
      target = null;
    }
    const opts = (w: number, h: number): ImageBitmapOptions => ({ imageOrientation: "from-image", resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
    try {
      let bmp: ImageBitmap;
      if (target) {
        bmp = await createImageBitmap(file, opts(target.width, target.height));
        // Some engines resize before applying EXIF rotation: detect the squashed result and redo swapped.
        if (ratioOff(bmp.width, bmp.height, target.width, target.height)) {
          bmp.close();
          bmp = await createImageBitmap(file, opts(target.height, target.width));
        }
      } else {
        bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      }
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      /* fall through to <img> decoding */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => img.removeAttribute("src") };
  } catch {
    throw new DecodeError(decodeErrorMessage(file.name));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

/** Downscale + re-encode to JPEG so the result is ≤ maxBytes. Call for one file at a time. */
export async function prepareImage(file: File, maxBytes: number): Promise<File> {
  const img = await decode(file);
  const canvas = document.createElement("canvas");
  try {
    let edge = MAX_EDGE;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { width, height } = fitWithin(img.width, img.height, edge);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new DecodeError(decodeErrorMessage(file.name));
      ctx.fillStyle = "#fff"; // transparent PNGs → white, not black
      ctx.fillRect(0, 0, width, height);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img.source, 0, 0, width, height);
      const blob = await toBlob(canvas, attempt === 0 ? JPEG_QUALITY : 0.72);
      if (blob && blob.size <= maxBytes) return new File([blob], toJpegName(file.name), { type: "image/jpeg" });
      edge = Math.round(edge * 0.75);
    }
    throw new DecodeError(`"${file.name}" is too large even after shrinking. Try a different photo.`);
  } finally {
    img.release();
    // free the backing store right away (matters on phones)
    canvas.width = 0;
    canvas.height = 0;
  }
}
