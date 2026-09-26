/** Small Response helpers and a size-bounded body reader for the admin handlers. */
import fs from "node:fs/promises";
import type { ApiError } from "./types.ts";

export class HttpError extends Error {
  name = "HttpError";
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

export const errorResponse = (status: number, code: string, message: string) =>
  json({ error: code, message } satisfies ApiError, status);

const tooLarge = (limit: number) =>
  new HttpError(
    413,
    "too_large",
    `That's too big. The limit is ${Math.round(limit / (1024 * 1024))} MB per file.`,
  );

/**
 * Read the whole body, but stop as soon as it passes `limit` bytes (Content-Length can be absent
 * or wrong with chunked uploads, so count what actually arrives).
 */
export async function readBodyLimited(request: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) throw tooLarge(limit);
  if (!request.body) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw tooLarge(limit);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readJson(request: Request, limit: number): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new HttpError(415, "bad_type", "Expected a JSON request.");
  }
  const body = await readBodyLimited(request, limit);
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new HttpError(400, "bad_json", "The request wasn't valid JSON.");
  }
}

/** Re-parse an already size-checked multipart body with the platform FormData parser. */
export async function readFormData(request: Request, limit: number): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data"))
    throw new HttpError(415, "bad_type", "Expected a file upload.");
  const body = await readBodyLimited(request, limit);
  try {
    return await new Response(body, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new HttpError(400, "bad_form", "The upload was incomplete or malformed. Try again.");
  }
}

/**
 * Stream a raw request body into `file`, counting bytes as they arrive and stopping (and
 * deleting the partial file) as soon as it passes `limit`. Returns the byte count.
 */
export async function streamBodyToFile(request: Request, file: string, limit: number): Promise<number> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) throw tooLarge(limit);
  if (!request.body) return 0;
  const handle = await fs.open(file, "wx");
  let total = 0;
  try {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw tooLarge(limit);
      }
      await handle.write(value);
    }
  } catch (err) {
    await handle.close();
    await fs.rm(file, { force: true });
    throw err;
  }
  await handle.close();
  return total;
}
