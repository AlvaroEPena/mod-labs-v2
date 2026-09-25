/**
 * Build-time LQIP (low-quality image placeholder) generator.
 * Produces a ~20px WebP data URI per gallery photo, cached on disk in
 * node_modules/.astro/lqip-cache.json (keyed by file + size + mtime) so rebuilds are instant.
 * Server/build only: never imported by client scripts.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const GALLERY_DIR = path.join(process.cwd(), "src", "assets", "gallery");
const CACHE_FILE = path.join(process.cwd(), "node_modules", ".astro", "lqip-cache.json");
const LQIP_WIDTH = 20;

type Cache = Record<string, string>;

let cache: Cache | undefined;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<string, Promise<string>>();

function loadCache(): Cache {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as Cache;
  } catch {
    cache = {};
  }
  return cache;
}

function scheduleWrite() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    } catch {
      /* cache is an optimization only */
    }
  }, 250);
}

/** `file` is relative to src/assets/gallery, e.g. "switch/switch-misc-01.jpg". */
export function lqip(file: string): Promise<string> {
  const abs = path.join(GALLERY_DIR, file);
  const stat = fs.statSync(abs);
  const key = `${file}|${stat.size}|${Math.round(stat.mtimeMs)}|${LQIP_WIDTH}`;
  const c = loadCache();
  const hit = c[key];
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(key);
  if (inflight) return inflight;

  const job = sharp(abs)
    .rotate()
    .resize(LQIP_WIDTH)
    .modulate({ saturation: 1.15 })
    .webp({ quality: 40, effort: 4 })
    .toBuffer()
    .then((buf) => {
      const uri = `data:image/webp;base64,${buf.toString("base64")}`;
      c[key] = uri;
      pending.delete(key);
      scheduleWrite();
      return uri;
    });
  pending.set(key, job);
  return job;
}
