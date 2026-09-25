/** Admin paths and limits. Every file path the server touches is derived here, never from a request. */
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

export type AdminPaths = {
  root: string;
  photosJson: string;
  photosDir: string;
  trashDir: string;
  trashManifest: string;
  thumbCacheDir: string;
};

export function pathsFor(root: string): AdminPaths {
  return {
    root,
    photosJson: path.join(root, "src", "data", "photos.json"),
    photosDir: path.join(root, "src", "assets", "gallery", "photos"),
    trashDir: path.join(root, ".admin-trash"),
    trashManifest: path.join(root, ".admin-trash", "trash.json"),
    thumbCacheDir: path.join(root, "node_modules", ".cache", "mod-labs-admin", "thumbs"),
  };
}

/** `--port 4401`, `--port=4401` or ADMIN_PORT=4401; defaults to 4400. */
export function resolvePort(argv: readonly string[], env: Record<string, string | undefined>): number {
  const flagIndex = argv.findIndex((a) => a === "--port" || a.startsWith("--port="));
  const flag =
    flagIndex === -1
      ? undefined
      : argv[flagIndex].includes("=")
        ? argv[flagIndex].split("=")[1]
        : argv[flagIndex + 1];
  const raw = flag ?? env.ADMIN_PORT;
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Invalid port "${raw}". Use a number between 1024 and 65535.`);
  }
  return port;
}
