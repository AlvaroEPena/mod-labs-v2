/**
 * Request routing and guards for the photo admin. Works on standard Request/Response objects so
 * it can be tested without opening a port; `server.ts` adapts it to node:http.
 */
import { readdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createHandlers } from "./handlers.ts";
import { parseArrangeBody, parseId, parseIdsBody, parseMoveBody, parseVideoUpdateBody } from "./lib/parse.ts";
import { MAX_JSON_BYTES, MAX_UPLOAD_BODY_BYTES, type AdminPaths } from "./lib/config.ts";
import { errorResponse, HttpError, json, readFormData, readJson } from "./lib/http.ts";
import { ListError } from "./lib/list-ops.ts";
import {
  isAllowedHost,
  isAllowedOrigin,
  isValidToken,
  SECURITY_HEADERS,
  TOKEN_HEADER,
  TOKEN_QUERY,
} from "./lib/security.ts";
import { fileResponse } from "./lib/serve-file.ts";
import type { Storage } from "./lib/storage.ts";
import type { PendingChanges } from "./lib/types.ts";
import { createJobRunner, JOB_ID } from "./lib/video-jobs.ts";
import type { VideoStorage } from "./lib/video-storage.ts";
import { createVideoHandlers } from "./video-handlers.ts";

export type AppOptions = {
  port: number;
  token: string;
  paths: AdminPaths;
  storage: Storage;
  videoStorage: VideoStorage;
  pending: () => Promise<PendingChanges>;
  /** where index.html and the UI modules live */
  publicDir: string;
  logError?: (err: unknown) => void;
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

/**
 * The only static files served: those in admin/public with an allowed extension, listed once at
 * startup. Requests are looked up in this map by exact name, never joined onto a disk path.
 */
function listStaticFiles(publicDir: string): Map<string, { file: string; type: string }> {
  const files = new Map<string, { file: string; type: string }>();
  for (const name of readdirSync(publicDir)) {
    const type = CONTENT_TYPES[path.extname(name)];
    if (type) files.set(name === "index.html" ? "/" : `/${name}`, { file: name, type });
  }
  return files;
}

const TOKEN_PLACEHOLDER = "__ADMIN_TOKEN__";
const THUMB_ROUTE = /^\/api\/thumb\/(\d{1,7})$/;
/** Media elements can't send headers either, so video previews also take the token as `?t=`. */
const VIDEO_FILE_ROUTE = /^\/api\/video\/(\d{1,7})$/;
const JOB_ROUTE = /^\/api\/videos\/jobs\/([^/]+)$/;
const STATUS_FOR_LIST_ERROR = { not_found: 404, stale: 409, invalid: 400 } as const;

export function createApp(options: AppOptions): (request: Request) => Promise<Response> {
  const { port, token, storage, videoStorage, paths, pending, publicDir } = options;
  const handlers = createHandlers({ storage, videoStorage, paths, pending });
  const videos = createVideoHandlers({
    storage,
    videoStorage,
    paths,
    jobs: createJobRunner(),
    getState: handlers.getState,
    logError: options.logError,
  });
  const staticFiles = listStaticFiles(publicDir);

  async function serveStatic(pathname: string): Promise<Response> {
    const entry = staticFiles.get(pathname);
    if (!entry) return errorResponse(404, "not_found", "Not found.");
    const body = await fs.readFile(path.join(publicDir, entry.file), "utf8");
    const text = pathname === "/" ? body.replace(TOKEN_PLACEHOLDER, token) : body;
    return new Response(text, { headers: { "Content-Type": entry.type } });
  }

  async function routeApi(request: Request, url: URL): Promise<Response> {
    const { pathname } = url;
    if (request.method === "GET") {
      if (pathname === "/api/state") return json(await handlers.getState());
      const thumb = THUMB_ROUTE.exec(pathname);
      if (thumb) {
        const data = await handlers.thumb(parseId(Number(thumb[1])));
        // ids are never reused and photos are never edited in place, so a thumb URL never changes
        return new Response(data, {
          headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=31536000, immutable" },
        });
      }
      const videoFile = VIDEO_FILE_ROUTE.exec(pathname);
      if (videoFile) {
        const file = await videos.previewFile(parseId(Number(videoFile[1])));
        return fileResponse(file, request.headers.get("range"), "video/mp4");
      }
      const job = JOB_ROUTE.exec(pathname);
      if (job) {
        if (!JOB_ID.test(job[1])) return errorResponse(404, "not_found", "Unknown upload.");
        return json(videos.job(job[1]));
      }
      return errorResponse(404, "not_found", "Unknown API route.");
    }

    const readBody = () => readJson(request, MAX_JSON_BYTES);
    switch (pathname) {
      case "/api/videos/upload":
        // The raw file is the body (streamed to disk, 500 MB max); details are in the query.
        return json(await videos.upload(request, url), 202);
      case "/api/videos/move":
        return json(await videos.move(parseMoveBody(await readBody())));
      case "/api/videos/arrange":
        return json(await videos.arrange(parseArrangeBody(await readBody())));
      case "/api/videos/update":
        return json(await videos.update(parseVideoUpdateBody(await readBody())));
      case "/api/videos/delete":
        return json(await videos.remove(parseIdsBody(await readBody())));
      case "/api/videos/restore":
        return json(await videos.restore(parseIdsBody(await readBody())));
      case "/api/move":
        return json(await handlers.move(parseMoveBody(await readJson(request, MAX_JSON_BYTES))));
      case "/api/arrange":
        return json(await handlers.arrange(parseArrangeBody(await readJson(request, MAX_JSON_BYTES))));
      case "/api/delete":
        return json(await handlers.remove(parseIdsBody(await readJson(request, MAX_JSON_BYTES))));
      case "/api/restore":
        return json(await handlers.restore(parseIdsBody(await readJson(request, MAX_JSON_BYTES))));
      case "/api/upload":
        return json(await handlers.upload(await readFormData(request, MAX_UPLOAD_BODY_BYTES)));
      default:
        return errorResponse(404, "not_found", "Unknown API route.");
    }
  }

  async function route(request: Request): Promise<Response> {
    if (!isAllowedHost(request.headers.get("host"), port)) {
      return errorResponse(403, "bad_host", `Open the admin at http://127.0.0.1:${port}/`);
    }
    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return request.method === "GET"
        ? serveStatic(url.pathname)
        : errorResponse(405, "method", "Method not allowed.");
    }

    const isMediaGet =
      request.method === "GET" && (THUMB_ROUTE.test(url.pathname) || VIDEO_FILE_ROUTE.test(url.pathname));
    const presented =
      request.headers.get(TOKEN_HEADER) ?? (isMediaGet ? url.searchParams.get(TOKEN_QUERY) : null);
    if (!isValidToken(presented, token)) {
      return errorResponse(
        401,
        "bad_token",
        "This admin page is out of date (the server was restarted). Reload the page.",
      );
    }
    if (request.method === "POST" && !isAllowedOrigin(request.headers.get("origin"), port)) {
      return errorResponse(403, "bad_origin", "Changes can only be made from the admin page itself.");
    }
    return routeApi(request, url);
  }

  function toErrorResponse(err: unknown): Response {
    if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message);
    if (err instanceof ListError)
      return errorResponse(STATUS_FOR_LIST_ERROR[err.code], err.code, err.message);
    options.logError?.(err);
    return errorResponse(
      500,
      "server_error",
      "Something went wrong on the admin server. Check the terminal for details.",
    );
  }

  return async (request) => {
    const response = await route(request).catch(toErrorResponse);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!response.headers.has(name)) response.headers.set(name, value);
    }
    return response;
  };
}
