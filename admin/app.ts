/**
 * Request routing and guards for the photo admin. Works on standard Request/Response objects so
 * it can be tested without opening a port; `server.ts` adapts it to node:http.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHandlers, parseId, parseIdBody, parseMoveBody, parseReorderBody } from "./handlers.ts";
import { MAX_JSON_BYTES, MAX_UPLOAD_BODY_BYTES, type AdminPaths } from "./lib/config.ts";
import { errorResponse, HttpError, json, readFormData, readJson } from "./lib/http.ts";
import { PhotoListError } from "./lib/photos.ts";
import {
  isAllowedHost,
  isAllowedOrigin,
  isValidToken,
  SECURITY_HEADERS,
  TOKEN_HEADER,
  TOKEN_QUERY,
} from "./lib/security.ts";
import type { Storage } from "./lib/storage.ts";
import type { PendingChanges } from "./lib/types.ts";

export type AppOptions = {
  port: number;
  token: string;
  paths: AdminPaths;
  storage: Storage;
  pending: () => Promise<PendingChanges>;
  /** where index.html and the UI modules live */
  publicDir: string;
  logError?: (err: unknown) => void;
};

/** The only static files served. Request paths are looked up here, never joined onto the disk path. */
const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/api.js": { file: "api.js", type: "text/javascript; charset=utf-8" },
  "/render.js": { file: "render.js", type: "text/javascript; charset=utf-8" },
  "/order.js": { file: "order.js", type: "text/javascript; charset=utf-8" },
  "/upload.js": { file: "upload.js", type: "text/javascript; charset=utf-8" },
  "/dnd.js": { file: "dnd.js", type: "text/javascript; charset=utf-8" },
  "/favicon.svg": { file: "favicon.svg", type: "image/svg+xml" },
};

const TOKEN_PLACEHOLDER = "__ADMIN_TOKEN__";
const THUMB_ROUTE = /^\/api\/thumb\/(\d{1,7})$/;
const STATUS_FOR_LIST_ERROR = { not_found: 404, stale: 409, invalid: 400 } as const;

export function createApp(options: AppOptions): (request: Request) => Promise<Response> {
  const { port, token, storage, paths, pending, publicDir } = options;
  const handlers = createHandlers({ storage, paths, pending });

  async function serveStatic(pathname: string): Promise<Response> {
    const entry = STATIC_FILES[pathname];
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
      return errorResponse(404, "not_found", "Unknown API route.");
    }

    switch (pathname) {
      case "/api/reorder":
        return json(await handlers.reorder(parseReorderBody(await readJson(request, MAX_JSON_BYTES))));
      case "/api/move":
        return json(await handlers.move(parseMoveBody(await readJson(request, MAX_JSON_BYTES))));
      case "/api/delete":
        return json(await handlers.remove(parseIdBody(await readJson(request, MAX_JSON_BYTES))));
      case "/api/restore":
        return json(await handlers.restore(parseIdBody(await readJson(request, MAX_JSON_BYTES))));
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

    const isThumb = request.method === "GET" && THUMB_ROUTE.test(url.pathname);
    const presented =
      request.headers.get(TOKEN_HEADER) ?? (isThumb ? url.searchParams.get(TOKEN_QUERY) : null);
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
    if (err instanceof PhotoListError)
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
