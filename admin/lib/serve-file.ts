/** Stream a file from disk, honouring a single HTTP Range (what <video> uses to seek). */
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";

/** Parse `bytes=start-end` / `bytes=start-` / `bytes=-suffix` for a file of `size` bytes. */
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (match[1] === "") {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start > end || start >= size ? "invalid" : { start, end };
}

export async function fileResponse(
  file: string,
  rangeHeader: string | null,
  contentType: string,
): Promise<Response> {
  const { size } = await fs.stat(file);
  const range = parseRange(rangeHeader, size);
  const headers = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
  };
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      "Content-Length": String(end - start + 1),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}
