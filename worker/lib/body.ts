export type BodyResult =
  | { ok: true; formData: FormData }
  | { ok: false; reason: "length_required" | "too_large" | "unsupported" | "invalid" };

/** A pass-through stream that errors as soon as more than `maxBytes` have flowed through it. */
export function byteLimitStream(maxBytes: number, onExceed: () => void = () => {}): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) {
        onExceed();
        controller.error(new Error("request body too large"));
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

/**
 * Parse a form body with a hard size cap:
 *  1. require Content-Length (browsers always send it for FormData) and reject if it exceeds the cap;
 *  2. enforce the cap again while streaming, so a lying/absent length can't push more bytes through.
 */
export async function readFormDataLimited(request: Request, maxBytes: number): Promise<BodyResult> {
  const rawLength = request.headers.get("Content-Length");
  if (rawLength === null || !/^\d+$/.test(rawLength.trim())) return { ok: false, reason: "length_required" };
  if (Number(rawLength) > maxBytes) return { ok: false, reason: "too_large" };

  const contentType = request.headers.get("Content-Type") ?? "";
  const ct = contentType.toLowerCase();
  if (!ct.startsWith("multipart/form-data") && !ct.startsWith("application/x-www-form-urlencoded")) {
    return { ok: false, reason: "unsupported" };
  }
  if (!request.body) return { ok: true, formData: new FormData() };

  let exceeded = false;
  const counted = request.body.pipeThrough(byteLimitStream(maxBytes, () => (exceeded = true)));
  try {
    const formData = await new Response(counted, { headers: { "Content-Type": contentType } }).formData();
    return { ok: true, formData };
  } catch {
    // The runtime may wrap the stream error, so rely on the flag rather than the error type.
    return { ok: false, reason: exceeded ? "too_large" : "invalid" };
  }
}
