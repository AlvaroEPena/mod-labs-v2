/**
 * Test harness: a throwaway copy of the data layout in a temp dir (photos, one video, trash) and
 * the admin app wired to it. No port is opened; requests go straight to the app.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach } from "vitest";
import { formatPhotosJson, photoFileForId, type PhotoRecord } from "../../src/lib/gallery/records.ts";
import { formatVideosJson, type VideoRecord } from "../../src/lib/gallery/video-records.ts";
import { createApp } from "../app.ts";
import { projectSlugs } from "../handlers.ts";
import { pathsFor, type AdminPaths } from "../lib/config.ts";
import { createLock } from "../lib/lock.ts";
import { createStorage } from "../lib/storage.ts";
import { createVideoStorage } from "../lib/video-storage.ts";

export const PORT = 4400;
export const TOKEN = "test-token-0123456789";
export const ORIGIN = `http://127.0.0.1:${PORT}`;
const publicDir = path.resolve(import.meta.dirname, "../public");

export const rec = (id: number, project: string): PhotoRecord => ({
  id,
  file: photoFileForId(id),
  project,
  width: 40,
  height: 30,
});
export const initialPhotos = [rec(10, "gwii"), rec(11, "gwii"), rec(12, "gwii"), rec(20, "gboy")];
export const initialVideos: VideoRecord[] = [
  { id: 1, file: "legacy-clip.mp4", project: "gwii", title: "Legacy clip", posterId: 11 },
];

export const jpeg = (width = 40, height = 30) =>
  sharp({ create: { width, height, channels: 3, background: "#0af" } })
    .jpeg()
    .toBuffer();

export type SendOptions = {
  method?: string;
  host?: string;
  token?: string | null;
  origin?: string | null;
  json?: unknown;
  body?: RequestInit["body"];
  contentType?: string;
};

export type TestAdmin = {
  root: string;
  paths: AdminPaths;
  send: (pathname: string, options?: SendOptions) => Promise<Response>;
  post: (pathname: string, json: unknown, options?: SendOptions) => Promise<Response>;
  /** A hand-built request (any headers), straight to the app. */
  sendRaw: (request: Request) => Promise<Response>;
  readPhotos: () => Promise<PhotoRecord[]>;
  readVideos: () => Promise<VideoRecord[]>;
};

/** Registers beforeEach/afterEach; the returned object is filled in before each test. */
export function useTestAdmin(): TestAdmin {
  const ctx = {} as TestAdmin;
  let app: (request: Request) => Promise<Response>;

  beforeEach(async () => {
    ctx.root = await fs.mkdtemp(path.join(os.tmpdir(), "mod-labs-admin-"));
    ctx.paths = pathsFor(ctx.root);
    const { paths } = ctx;
    await fs.mkdir(paths.photosDir, { recursive: true });
    await fs.mkdir(paths.mediaDir, { recursive: true });
    await fs.mkdir(path.dirname(paths.photosJson), { recursive: true });
    await fs.writeFile(paths.photosJson, formatPhotosJson(initialPhotos));
    await fs.writeFile(paths.videosJson, formatVideosJson(initialVideos));
    for (const r of initialPhotos)
      await fs.writeFile(path.join(paths.photosDir, path.basename(r.file)), await jpeg());
    for (const v of initialVideos)
      await fs.writeFile(path.join(paths.mediaDir, v.file), "not really a video");
    const lock = createLock();
    app = createApp({
      port: PORT,
      token: TOKEN,
      paths,
      storage: createStorage(paths, projectSlugs, lock),
      videoStorage: createVideoStorage(paths, projectSlugs),
      pending: async () => ({ count: 0 }),
      publicDir,
    });
  });

  afterEach(async () => {
    await fs.rm(ctx.root, { recursive: true, force: true });
  });

  ctx.send = (
    pathname,
    { method, host = `127.0.0.1:${PORT}`, token = TOKEN, origin = ORIGIN, json, body, contentType } = {},
  ) => {
    const headers = new Headers({ host });
    if (token) headers.set("x-admin-token", token);
    if (origin) headers.set("origin", origin);
    if (json !== undefined) headers.set("content-type", "application/json");
    if (contentType) headers.set("content-type", contentType);
    const hasBody = json !== undefined || body !== undefined;
    return app(
      new Request(`http://127.0.0.1:${PORT}${pathname}`, {
        method: method ?? (hasBody ? "POST" : "GET"),
        headers,
        body: json !== undefined ? JSON.stringify(json) : body,
      }),
    );
  };
  ctx.post = (pathname, json, options = {}) => ctx.send(pathname, { ...options, json });
  ctx.sendRaw = (request) => app(request);
  ctx.readPhotos = async () => JSON.parse(await fs.readFile(ctx.paths.photosJson, "utf8")) as PhotoRecord[];
  ctx.readVideos = async () => JSON.parse(await fs.readFile(ctx.paths.videosJson, "utf8")) as VideoRecord[];
  return ctx;
}

export const idsOf = (list: { id: number; project: string }[], project: string) =>
  list.filter((p) => p.project === project).map((p) => p.id);
