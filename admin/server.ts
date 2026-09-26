/**
 * Mod Labs local photo admin: `npm run admin` (optionally `-- --port 4401` or ADMIN_PORT=4401).
 * Runs only on this computer (127.0.0.1) and is never built or deployed with the site.
 */
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { createApp } from "./app.ts";
import { HOSTNAME, pathsFor, resolvePort, resolveRoot } from "./lib/config.ts";
import { gitPendingChanges } from "./lib/git-status.ts";
import { createToken } from "./lib/security.ts";
import { createLock } from "./lib/lock.ts";
import { createStorage } from "./lib/storage.ts";
import { createVideoStorage } from "./lib/video-storage.ts";
import { projectSlugs } from "./handlers.ts";

const siteRoot = path.resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const port = resolvePort(argv, process.env);
const root = resolveRoot(argv, process.env, siteRoot);
const paths = pathsFor(root);

const lock = createLock();
const handle = createApp({
  port,
  token: createToken(),
  paths,
  storage: createStorage(paths, projectSlugs, lock),
  videoStorage: createVideoStorage(paths, projectSlugs),
  pending: () => gitPendingChanges(root),
  publicDir: path.join(import.meta.dirname, "public"),
  logError: (err) => console.error("[admin] request failed:", err),
});

/** node:http → Fetch API Request/Response. The URL base is fixed; the real Host header is kept for the guard. */
const server = http.createServer(async (req, res) => {
  try {
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(new URL(req.url ?? "/", `http://${HOSTNAME}:${port}`), {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([name, value]) =>
        value === undefined
          ? []
          : (Array.isArray(value) ? value : [value]).map((v): [string, string] => [name, v]),
      ),
      body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
      duplex: "half",
    });
    const response = await handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error("[admin] could not handle request:", err);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal error");
  }
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Is the admin already open? Or pick another: npm run admin -- --port ${port + 1}`,
    );
  } else {
    console.error("[admin] server error:", err);
  }
  process.exit(1);
});

server.listen(port, HOSTNAME, () => {
  console.log(`\n  Mod Labs photo admin is running (this computer only).\n`);
  console.log(`  Open:  http://${HOSTNAME}:${port}/\n`);
  if (root !== siteRoot)
    console.log(`  TEST MODE: using the data in ${root}, not the real site photos and videos.\n`);
  console.log(`  Preview the site at the same time: npm run dev (http://localhost:4321/gallery)`);
  console.log(`  Publish your changes: npm run deploy`);
  console.log(`  Stop: press Ctrl+C\n`);
});
