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

/* ---------- browser-only below ---------- */

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  if ("createImageBitmap" in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall through to <img> decoding (older Safari) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    throw new DecodeError(decodeErrorMessage(file.name));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

/** Downscale + re-encode to JPEG so the result is ≤ maxBytes. */
export async function prepareImage(file: File, maxBytes: number): Promise<File> {
  const img = await decode(file);
  try {
    let edge = MAX_EDGE;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { width, height } = fitWithin(img.width, img.height, edge);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new DecodeError(decodeErrorMessage(file.name));
      ctx.fillStyle = "#fff"; // transparent PNGs → white, not black
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img.source, 0, 0, width, height);
      const blob = await toBlob(canvas, attempt === 0 ? JPEG_QUALITY : 0.72);
      if (blob && blob.size <= maxBytes) return new File([blob], toJpegName(file.name), { type: "image/jpeg" });
      edge = Math.round(edge * 0.75);
    }
    throw new DecodeError(`"${file.name}" is too large even after shrinking. Try a different photo.`);
  } finally {
    img.close?.();
  }
}
