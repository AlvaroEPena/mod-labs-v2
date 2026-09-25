/**
 * Admin server handlers, end to end on a throwaway copy of the data layout (temp dir): guards,
 * every operation, and upload processing. No port is opened; requests go straight to the app.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatPhotosJson, photoFileForId, type PhotoRecord } from "../../src/lib/gallery/records.ts";
import { hasMetadata } from "../../scripts/lib/process-photo.mjs";
import { createApp } from "../app.ts";
import { projectSlugs } from "../handlers.ts";
import { pathsFor, type AdminPaths } from "../lib/config.ts";
import { createStorage } from "../lib/storage.ts";
import type { AdminState, ApiError, UploadResult } from "../lib/types.ts";

const PORT = 4400;
const TOKEN = "test-token-0123456789";
const ORIGIN = `http://127.0.0.1:${PORT}`;
const publicDir = path.resolve(import.meta.dirname, "../public");

const rec = (id: number, project: string): PhotoRecord => ({
  id,
  file: photoFileForId(id),
  project,
  width: 40,
  height: 30,
});
const initial = [rec(10, "gwii"), rec(11, "gwii"), rec(12, "gwii"), rec(20, "gboy")];

let root: string;
let paths: AdminPaths;
let app: (request: Request) => Promise<Response>;

const jpeg = (width = 40, height = 30) =>
  sharp({ create: { width, height, channels: 3, background: "#0af" } })
    .jpeg()
    .toBuffer();

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mod-labs-admin-"));
  paths = pathsFor(root);
  await fs.mkdir(paths.photosDir, { recursive: true });
  await fs.mkdir(path.dirname(paths.photosJson), { recursive: true });
  await fs.writeFile(paths.photosJson, formatPhotosJson(initial));
  for (const r of initial) await fs.writeFile(path.join(root, "src/assets/gallery", r.file), await jpeg());
  app = createApp({
    port: PORT,
    token: TOKEN,
    paths,
    storage: createStorage(paths, projectSlugs),
    pending: async () => ({ count: 0 }),
    publicDir,
  });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

type Options = {
  method?: string;
  host?: string;
  token?: string | null;
  origin?: string | null;
  json?: unknown;
  body?: RequestInit["body"];
};
function send(
  pathname: string,
  { method, host = `127.0.0.1:${PORT}`, token = TOKEN, origin = ORIGIN, json, body }: Options = {},
) {
  const headers = new Headers({ host });
  if (token) headers.set("x-admin-token", token);
  if (origin) headers.set("origin", origin);
  if (json !== undefined) headers.set("content-type", "application/json");
  const hasBody = json !== undefined || body !== undefined;
  return app(
    new Request(`http://127.0.0.1:${PORT}${pathname}`, {
      method: method ?? (hasBody ? "POST" : "GET"),
      headers,
      body: json !== undefined ? JSON.stringify(json) : body,
    }),
  );
}
const post = (pathname: string, json: unknown, options: Options = {}) => send(pathname, { ...options, json });
const readList = async () => JSON.parse(await fs.readFile(paths.photosJson, "utf8")) as PhotoRecord[];
const idsOf = (list: { id: number; project: string }[], project: string) =>
  list.filter((p) => p.project === project).map((p) => p.id);

function uploadForm(file: Blob, name: string, project = "gboy") {
  const form = new FormData();
  form.append("project", project);
  form.append("file", file, name);
  return form;
}

describe("guards", () => {
  it("serves the page with the token and strict security headers", async () => {
    const res = await send("/", { token: null });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`content="${TOKEN}"`);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("rejects API calls without the right token (401)", async () => {
    expect((await send("/api/state", { token: null })).status).toBe(401);
    expect((await send("/api/state", { token: "wrong" })).status).toBe(401);
    expect((await send("/api/thumb/10")).status).toBe(200); // header token
    expect((await send(`/api/thumb/10?t=${TOKEN}`, { token: null })).status).toBe(200); // <img> query token
    expect((await send("/api/state?t=" + TOKEN, { token: null })).status).toBe(401); // query token is thumbs-only
  });

  it("rejects any other Host, including the page itself (DNS rebinding)", async () => {
    for (const host of ["evil.example:4400", "127.0.0.1:9999", "127.0.0.1"]) {
      expect((await send("/", { host })).status, host).toBe(403);
      expect((await send("/api/state", { host })).status, host).toBe(403);
    }
    expect((await send("/api/state", { host: `localhost:${PORT}` })).status).toBe(200);
  });

  it("rejects changes without a same-origin Origin (403) and leaves the data alone", async () => {
    const body = { project: "gwii", ids: [12, 11, 10] };
    expect((await post("/api/reorder", body, { origin: null })).status).toBe(403);
    expect((await post("/api/reorder", body, { origin: "http://evil.example" })).status).toBe(403);
    expect(await readList()).toEqual(initial);
  });

  it("refuses other methods, unknown routes, bad JSON and bad input", async () => {
    expect((await send("/api/state", { method: "PUT" })).status).toBe(405);
    expect((await send("/api/nope")).status).toBe(404);
    expect((await send("/../src/data/photos.json", { token: null })).status).toBe(404);
    expect((await send("/api/reorder", { body: "{}" })).status).toBe(415);
    expect((await send("/api/delete", { json: undefined, body: "x", method: "POST" })).status).toBe(415);
    expect((await post("/api/delete", { id: "10" })).status).toBe(400);
    expect((await post("/api/delete", { id: 1.5 })).status).toBe(400);
    expect((await post("/api/move", { id: 10, project: "../../etc" })).status).toBe(400);
    expect((await post("/api/delete", { id: 999 })).status).toBe(404);
    expect((await post("/api/reorder", { project: "gwii", ids: "x".repeat(70_000) })).status).toBe(413);
  });
});

describe("operations", () => {
  it("returns the state grouped data the UI needs", async () => {
    const state = (await (await send("/api/state")).json()) as AdminState;
    expect(state.photos.map((p) => p.id)).toEqual([10, 11, 12, 20]);
    expect(state.photos[0].category).toBe("custom");
    expect(state.projects.some((p) => p.slug === "gwii")).toBe(true);
    expect(state.pending).toEqual({ count: 0 });
  });

  it("reorders a project and refuses a stale order with 409", async () => {
    const res = await post("/api/reorder", { project: "gwii", ids: [12, 10, 11] });
    expect(res.status).toBe(200);
    expect(idsOf(await readList(), "gwii")).toEqual([12, 10, 11]);
    expect((await post("/api/reorder", { project: "gwii", ids: [10, 11] })).status).toBe(409);
  });

  it("keeps the file canonical: moving a photo out and back, then reordering, gives identical bytes", async () => {
    const before = await fs.readFile(paths.photosJson, "utf8");
    await post("/api/move", { id: 10, project: "gboy" });
    await post("/api/move", { id: 10, project: "gwii" });
    expect((await post("/api/reorder", { project: "gwii", ids: [10, 11, 12] })).status).toBe(200);
    expect(await fs.readFile(paths.photosJson, "utf8")).toBe(before);
  });

  it("moves a photo to the end of another project", async () => {
    await post("/api/move", { id: 10, project: "gboy" });
    const list = await readList();
    expect(idsOf(list, "gboy")).toEqual([20, 10]);
    expect(idsOf(list, "gwii")).toEqual([11, 12]);
  });

  it("deletes to the trash and restores to the same spot, byte-for-byte", async () => {
    const before = await fs.readFile(paths.photosJson, "utf8");
    const deleted = (await (await post("/api/delete", { id: 11 })).json()) as AdminState;
    expect(deleted.trash.map((t) => t.id)).toEqual([11]);
    await expect(fs.access(path.join(paths.trashDir, "p0011.jpg"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(paths.photosDir, "p0011.jpg"))).rejects.toThrow();
    expect((await send("/api/thumb/11")).status).toBe(200); // trash view thumbnails

    expect((await post("/api/restore", { id: 11 })).status).toBe(200);
    expect(await fs.readFile(paths.photosJson, "utf8")).toBe(before);
    await expect(fs.access(path.join(paths.photosDir, "p0011.jpg"))).resolves.toBeUndefined();
    expect((await post("/api/restore", { id: 11 })).status).toBe(404);
  });
});

describe("upload", () => {
  it("strips EXIF/GPS, bakes rotation, caps the size, and never reuses an id", async () => {
    const withGps = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#f0a" } })
      .jpeg()
      .withMetadata({ orientation: 6 }) // phone held sideways
      .withExif({ IFD0: { Make: "TestCam" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "47/1 36/1 0/1" } })
      .toBuffer();
    expect(await hasMetadata(withGps)).toBe(true);

    await post("/api/delete", { id: 20 }); // highest id is now only in the trash
    const res = await send("/api/upload", {
      body: uploadForm(new Blob([withGps], { type: "image/jpeg" }), "IMG_0001.JPG"),
    });
    expect(res.status).toBe(200);
    const { photo, state } = (await res.json()) as UploadResult;

    expect(photo.id).toBe(21);
    expect(photo.file).toBe("photos/p0021.jpg");
    expect([photo.width, photo.height]).toEqual([1024, 2048]); // rotated upright, long edge 2048
    expect(state.photos.at(-1)?.id).toBe(21);
    const saved = path.join(paths.photosDir, "p0021.jpg");
    expect(await hasMetadata(saved)).toBe(false);
    expect(await sharp(saved).metadata()).toMatchObject({ format: "jpeg", width: 1024, height: 2048 });
    expect(await fs.readFile(paths.photosJson, "utf8")).toBe(formatPhotosJson(await readList()));
  });

  it("gives clear errors for HEIC, non-images and missing input", async () => {
    const heic = new Uint8Array([
      0,
      0,
      0,
      24,
      ...new TextEncoder().encode("ftypheic"),
      ...new Uint8Array(32),
    ]);
    const heicRes = await send("/api/upload", {
      body: uploadForm(new Blob([heic], { type: "image/heic" }), "IMG.HEIC"),
    });
    expect(heicRes.status).toBe(415);
    expect(((await heicRes.json()) as ApiError).message).toMatch(/HEIC.*Most Compatible/);

    const text = await send("/api/upload", {
      body: uploadForm(new Blob(["hello"], { type: "text/plain" }), "notes.txt"),
    });
    expect(text.status).toBe(415);
    expect(((await text.json()) as ApiError).message).toMatch(/isn't an image/);

    const fake = await send("/api/upload", {
      body: uploadForm(new Blob(["not a jpeg"], { type: "image/jpeg" }), "fake.jpg"),
    });
    expect(fake.status).toBe(415);
    expect(((await fake.json()) as ApiError).message).toMatch(/isn.t a photo we can read/);

    const noProject = await send("/api/upload", {
      body: uploadForm(new Blob([await jpeg()], { type: "image/jpeg" }), "a.jpg", "nope"),
    });
    expect(noProject.status).toBe(400);

    const form = new FormData();
    form.append("project", "gwii");
    expect((await send("/api/upload", { body: form })).status).toBe(400);
    expect(await readList()).toEqual(initial);
  });

  it("requires the token and a same-origin Origin", async () => {
    const body = () => uploadForm(new Blob([new Uint8Array(10)], { type: "image/jpeg" }), "a.jpg");
    expect((await send("/api/upload", { body: body(), token: null })).status).toBe(401);
    expect((await send("/api/upload", { body: body(), origin: "http://evil.example" })).status).toBe(403);
  });
});
