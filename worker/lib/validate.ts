import { z } from "zod";
import {
  bookSchema,
  fieldNames,
  formDataToObject,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_FILES,
  PHOTO_TYPES,
  quoteSchema,
  type BookInput,
  type QuoteInput,
} from "../../src/lib/forms/schema";

export type FormKind = "book" | "quote";

export type Submission = { kind: "book"; data: BookInput } | { kind: "quote"; data: QuoteInput };

export type ValidationResult =
  | { ok: true; submission: Submission }
  | { ok: false; fieldErrors: Record<string, string[]> };

/** Validate the text fields of a submission against the shared contract. */
export function validateFields(kind: FormKind, fd: FormData): ValidationResult {
  const input = formDataToObject(fd);
  let error: z.ZodError;
  if (kind === "book") {
    const parsed = bookSchema.safeParse(input);
    if (parsed.success) return { ok: true, submission: { kind, data: parsed.data } };
    error = parsed.error;
  } else {
    const parsed = quoteSchema.safeParse(input);
    if (parsed.success) return { ok: true, submission: { kind, data: parsed.data } };
    error = parsed.error;
  }
  const flat = z.flattenError(error);
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(flat.fieldErrors as Record<string, string[] | undefined>)) {
    if (messages && messages.length > 0) fieldErrors[key] = messages;
  }
  if (flat.formErrors.length > 0) fieldErrors._form = flat.formErrors;
  return { ok: false, fieldErrors };
}

/** The honeypot field is filled by bots only. */
export function isHoneypotTripped(fd: FormData): boolean {
  const v = fd.get(fieldNames.honeypot);
  return typeof v === "string" && v.trim().length > 0;
}

export interface Photo {
  name: string;
  type: (typeof PHOTO_TYPES)[number];
  size: number;
  file: File;
}

export type PhotoResult =
  | { ok: true; photos: Photo[] }
  | { ok: false; reason: "too_large"; message: string }
  | { ok: false; reason: "validation"; fieldErrors: Record<string, string[]> };

const MAGIC: Record<(typeof PHOTO_TYPES)[number], (b: Uint8Array) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/webp": (b) =>
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50, // WEBP
};

const isPhotoType = (t: string): t is (typeof PHOTO_TYPES)[number] =>
  (PHOTO_TYPES as readonly string[]).includes(t);

const photoError = (msg: string): PhotoResult => ({ ok: false, reason: "validation", fieldErrors: { photos: [msg] } });

/**
 * Validate the optional `photos` field (quote form). Empty file inputs are ignored.
 * Checks count, per-file size, declared MIME type and the file's magic bytes.
 */
export async function validatePhotos(fd: FormData): Promise<PhotoResult> {
  const files = fd
    .getAll(fieldNames.photos)
    .filter((v): v is File => typeof v !== "string" && v.size > 0);

  if (files.length > PHOTO_MAX_FILES) return photoError(`Attach at most ${PHOTO_MAX_FILES} photos.`);

  const photos: Photo[] = [];
  for (const file of files) {
    if (file.size > PHOTO_MAX_BYTES) {
      return {
        ok: false,
        reason: "too_large",
        message: `Each photo must be ${Math.floor(PHOTO_MAX_BYTES / 1_000_000)} MB or smaller.`,
      };
    }
    const type = file.type.toLowerCase();
    if (!isPhotoType(type)) return photoError("Photos must be JPEG, PNG or WebP images.");
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (!MAGIC[type](head)) return photoError("One of the photos isn't a valid image file.");
    photos.push({ name: file.name, type, size: file.size, file });
  }
  return { ok: true, photos };
}
