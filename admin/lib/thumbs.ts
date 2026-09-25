/**
 * Small WebP thumbnails for the admin grid, cached on disk (node_modules/.cache/mod-labs-admin)
 * keyed by id + source size + mtime, so a replaced file never shows a stale thumbnail.
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { THUMB_EDGE_PX } from "./config.ts";

const inflight = new Map<string, Promise<Uint8Array>>();

export async function thumbnail(source: string, id: number, cacheDir: string): Promise<Uint8Array> {
  const stat = await fs.stat(source);
  const cacheFile = path.join(
    cacheDir,
    `${id}-${stat.size}-${Math.round(stat.mtimeMs)}-${THUMB_EDGE_PX}.webp`,
  );
  try {
    return await fs.readFile(cacheFile);
  } catch {
    // not cached yet
  }

  const pending = inflight.get(cacheFile);
  if (pending) return pending;
  const job = (async () => {
    const data = await sharp(source)
      .rotate()
      .resize({ width: THUMB_EDGE_PX, height: THUMB_EDGE_PX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer();
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(cacheFile, data).catch(() => undefined); // the cache is only an optimisation
    return data;
  })();
  inflight.set(cacheFile, job);
  try {
    return await job;
  } finally {
    inflight.delete(cacheFile);
  }
}
