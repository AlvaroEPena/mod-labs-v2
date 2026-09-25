/**
 * The admin operations. Each validates its input, runs under the storage lock, and returns the
 * fresh AdminState so the UI simply re-renders from what's on disk.
 */
import { categories, projects } from "../src/data/projects.ts";
import { isPhotoId, photoFileForId, type PhotoRecord } from "../src/lib/gallery/records.ts";
import { looksLikeHeic, processPhoto, UnsupportedPhotoError } from "../scripts/lib/process-photo.mjs";
import { ACCEPTED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, type AdminPaths } from "./lib/config.ts";
import { HttpError } from "./lib/http.ts";
import { addPhoto, movePhoto, nextPhotoId, removePhoto, reorderProject, restorePhoto } from "./lib/photos.ts";
import type { Storage } from "./lib/storage.ts";
import { thumbnail } from "./lib/thumbs.ts";
import type {
  AdminPhoto,
  AdminState,
  IdBody,
  MoveBody,
  PendingChanges,
  ReorderBody,
  UploadResult,
} from "./lib/types.ts";

const categoryOf = new Map<string, string>(projects.map((p) => [p.slug, p.category]));
export const projectSlugs = projects.map((p) => p.slug);

const withCategory = (r: PhotoRecord): AdminPhoto => ({ ...r, category: categoryOf.get(r.project) ?? "" });

/* ---------- input parsing (the only way request data reaches the operations) ---------- */

const badRequest = (message: string) => new HttpError(400, "invalid", message);
const asObject = (body: unknown) => {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw badRequest("Expected a JSON object.");
  return body as Record<string, unknown>;
};
export function parseId(value: unknown): number {
  if (!isPhotoId(value)) throw badRequest("That isn't a valid photo id.");
  return value;
}
export function parseProject(value: unknown): string {
  if (typeof value !== "string" || !categoryOf.has(value))
    throw badRequest("Pick one of the gallery projects.");
  return value;
}
export const parseIdBody = (body: unknown): IdBody => ({ id: parseId(asObject(body).id) });
export const parseMoveBody = (body: unknown): MoveBody => {
  const o = asObject(body);
  return { id: parseId(o.id), project: parseProject(o.project) };
};
export const parseReorderBody = (body: unknown): ReorderBody => {
  const o = asObject(body);
  if (!Array.isArray(o.ids) || o.ids.length > 10_000) throw badRequest("Expected the list of photo ids.");
  return { project: parseProject(o.project), ids: o.ids.map(parseId) };
};

/* ---------- operations ---------- */

type HandlerDeps = { storage: Storage; paths: AdminPaths; pending: () => Promise<PendingChanges> };

export function createHandlers({ storage, paths, pending }: HandlerDeps) {
  async function getState(): Promise<AdminState> {
    const [photos, trash, changes] = await Promise.all([
      storage.readPhotos(),
      storage.readTrash(),
      pending(),
    ]);
    return {
      categories: categories.map((c) => ({ slug: c.slug, title: c.title })),
      projects: projects.map((p) => ({ slug: p.slug, title: p.title, category: p.category })),
      photos: photos.map(withCategory),
      trash: [...trash].reverse().map((t) => ({ ...t.record, deletedAt: t.deletedAt })),
      pending: changes,
      limits: { maxUploadBytes: MAX_UPLOAD_BYTES, acceptedTypes: ACCEPTED_UPLOAD_TYPES },
    };
  }

  /** Run a photos.json change under the lock, then report the new state. */
  const change = async (task: () => Promise<void>) => {
    await storage.withLock(task);
    return getState();
  };

  const reorder = (body: ReorderBody) =>
    change(async () => {
      await storage.writePhotos(reorderProject(await storage.readPhotos(), body.project, body.ids));
    });

  const move = (body: MoveBody) =>
    change(async () => {
      await storage.writePhotos(movePhoto(await storage.readPhotos(), body.id, body.project));
    });

  const remove = ({ id }: IdBody) =>
    change(async () => {
      const { list, removed, placement } = removePhoto(await storage.readPhotos(), id);
      await storage.writePhotos(list);
      await storage.moveToTrash(id);
      const trash = await storage.readTrash();
      const entry = { record: removed, deletedAt: new Date().toISOString(), ...placement };
      await storage.writeTrash([...trash.filter((t) => t.record.id !== id), entry]);
    });

  const restore = ({ id }: IdBody) =>
    change(async () => {
      const trash = await storage.readTrash();
      const entry = trash.find((t) => t.record.id === id);
      if (!entry)
        throw new HttpError(404, "not_found", "That photo isn't in the trash any more. Reload the page.");
      // The project may have been removed from the site since it was deleted; fall back to the first one.
      const project = categoryOf.has(entry.record.project) ? entry.record.project : projectSlugs[0];
      const list = restorePhoto(await storage.readPhotos(), { ...entry.record, project }, entry);
      await storage.moveFromTrash(id);
      await storage.writePhotos(list);
      await storage.writeTrash(trash.filter((t) => t.record.id !== id));
    });

  async function upload(form: FormData): Promise<UploadResult> {
    const project = parseProject(form.get("project"));
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw badRequest("Choose a photo to upload.");
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new HttpError(
        413,
        "too_large",
        `"${file.name}" is too big. The limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isDeclaredImage = file.type === "" || file.type.startsWith("image/");
    if (!isDeclaredImage && !looksLikeHeic(bytes))
      throw new HttpError(415, "unsupported", `"${file.name}" isn't an image.`);

    let processed: Awaited<ReturnType<typeof processPhoto>>;
    try {
      processed = await processPhoto(Buffer.from(bytes));
    } catch (err) {
      if (err instanceof UnsupportedPhotoError)
        throw new HttpError(415, "unsupported", `"${file.name}": ${err.message}`);
      throw err;
    }

    let added: PhotoRecord | undefined;
    const state = await change(async () => {
      const [list, trash, onDisk] = await Promise.all([
        storage.readPhotos(),
        storage.readTrash(),
        storage.idsOnDisk(),
      ]);
      const id = nextPhotoId([...list.map((p) => p.id), ...trash.map((t) => t.record.id), ...onDisk]);
      added = { id, file: photoFileForId(id), project, width: processed.width, height: processed.height };
      await storage.writeNewPhoto(id, processed.data);
      await storage.writePhotos(addPhoto(list, added));
    });
    if (!added) throw new Error("upload finished without a photo record");
    return { state, photo: withCategory(added) };
  }

  /** Thumbnail for a gallery or trashed photo. The file path comes from the id, never the request. */
  async function thumb(id: number): Promise<Uint8Array> {
    const [list, trash] = await Promise.all([storage.readPhotos(), storage.readTrash()]);
    if (list.some((p) => p.id === id)) return thumbnail(storage.galleryFile(id), id, paths.thumbCacheDir);
    if (trash.some((t) => t.record.id === id))
      return thumbnail(storage.trashFile(id), id, paths.thumbCacheDir);
    throw new HttpError(404, "not_found", "No such photo.");
  }

  return { getState, reorder, move, remove, restore, upload, thumb };
}
