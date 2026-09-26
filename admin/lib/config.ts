/** Admin paths and limits. Every file path the server touches is derived here, never from a request. */
import { existsSync } from "node:fs";
import path from "node:path";

export const DEFAULT_PORT = 4400;
export const HOSTNAME = "127.0.0.1";

/** JSON bodies are tiny (an id, or a project's id list). */
export const MAX_JSON_BYTES = 64 * 1024;
/** One photo per upload request. Phone photos are ~3–15 MB; leave room for big PNGs. */
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
/** Multipart overhead on top of the file itself. */
export const MAX_UPLOAD_BODY_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;
export const ACCEPTED_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/tiff"];

export const THUMB_EDGE_PX = 360;

/** Video uploads stream to disk (never held in memory); processing makes them ≤ 24 MiB. */
export const MAX_VIDEO_UPLOAD_BYTES = 500 * 1024 * 1024;
export const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const ACCEPTED_VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm"];

export type AdminPaths = {
  root: string;
  photosJson: string;
  photosDir: string;
  trashDir: string;
  trashManifest: string;
  thumbCacheDir: string;
  videosJson: string;
  mediaDir: string;
  videoTrashManifest: string;
  uploadDir: string;
};

export function pathsFor(root: string): AdminPaths {
  return {
    root,
    photosJson: path.join(root, "src", "data", "photos.json"),
    photosDir: path.join(root, "src", "assets", "gallery", "photos"),
    trashDir: path.join(root, ".admin-trash"),
    trashManifest: path.join(root, ".admin-trash", "trash.json"),
    thumbCacheDir: path.join(root, "node_modules", ".cache", "mod-labs-admin", "thumbs"),
    videosJson: path.join(root, "src", "data", "videos.json"),
    mediaDir: path.join(root, "public", "media"),
    videoTrashManifest: path.join(root, ".admin-trash", "videos.json"),
    uploadDir: path.join(root, "node_modules", ".cache", "mod-labs-admin", "uploads"),
  };
}

/** Value of `--name value` or `--name=value`, if given. */
function readFlag(argv: readonly string[], name: string): string | undefined {
  const index = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (index === -1) return undefined;
  return argv[index].includes("=") ? argv[index].slice(name.length + 3) : argv[index + 1];
}

/** `--port 4401`, `--port=4401` or ADMIN_PORT=4401; defaults to 4400. */
export function resolvePort(argv: readonly string[], env: Record<string, string | undefined>): number {
  const raw = readFlag(argv, "port") ?? env.ADMIN_PORT;
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Invalid port "${raw}". Use a number between 1024 and 65535.`);
  }
  return port;
}

/**
 * TESTING OPTION: `--root <dir>` or ADMIN_ROOT=<dir> points the admin at a copy of the data
 * (<dir>/src/data/photos.json + videos.json, <dir>/src/assets/gallery/photos/, <dir>/public/media/,
 * <dir>/.admin-trash/) instead of this site folder, so tests never touch the real data.
 * Defaults to the site folder.
 */
export function resolveRoot(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  siteRoot: string,
): string {
  const raw = readFlag(argv, "root") ?? env.ADMIN_ROOT;
  if (raw === undefined || raw === "") return siteRoot;
  const root = path.resolve(raw);
  if (!existsSync(pathsFor(root).photosJson)) {
    throw new Error(`--root "${raw}" has no src/data/photos.json. Copy the data there first.`);
  }
  return root;
}
