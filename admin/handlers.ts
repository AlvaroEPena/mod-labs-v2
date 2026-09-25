/**
 * The admin operations. Each validates its input, runs under the storage lock, and returns the
 * fresh AdminState so the UI simply re-renders from what's on disk.
 */
import { categories, projects } from "../src/data/projects.ts";
import { photoFileForId, type PhotoRecord } from "../src/lib/gallery/records.ts";
import { looksLikeHeic, processPhoto, UnsupportedPhotoError } from "../scripts/lib/process-photo.mjs";
import { ACCEPTED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, type AdminPaths } from "./lib/config.ts";
import { HttpError } from "./lib/http.ts";
import { parseProject } from "./lib/parse.ts";
import {
  addPhoto,
  arrangeProjects,
  movePhotos,
  nextPhotoId,
  removePhotos,
  restorePhotos,
} from "./lib/photos.ts";
import type { Storage } from "./lib/storage.ts";
import { thumbnail } from "./lib/thumbs.ts";
import type {
  AdminPhoto,
  AdminState,
  ArrangeBody,
  IdsBody,
  MoveBody,
  PendingChanges,
  TrashEntry,
  UploadResult,
} from "./lib/types.ts";

const categoryOf = new Map<string, string>(projects.map((p) => [p.slug, p.category]));
export const projectSlugs = projects.map((p) => p.slug);

const withCategory = (r: PhotoRecord): AdminPhoto => ({ ...r, category: categoryOf.get(r.project) ?? "" });

/** Run file moves one by one, attempting all of them, then report the first failure (if any). */
async function moveAll(ids: readonly number[], moveOne: (id: number) => Promise<void>): Promise<void> {
  const results = await Promise.allSettled(ids.map((id) => moveOne(id)));
  const failed = results.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
}

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

  /** Move photos into a project (dialog, drag and drop, keyboard). One photos.json write. */
  const move = ({ ids, project, beforeId }: MoveBody) =>
    change(async () => {
      await storage.writePhotos(movePhotos(await storage.readPhotos(), ids, project, beforeId));
    });

  /** Set exact project contents/order (undo of a move or drag). One photos.json write. */
  const arrange = ({ layout }: ArrangeBody) =>
    change(async () => {
      await storage.writePhotos(arrangeProjects(await storage.readPhotos(), layout));
    });

  /**
   * Delete photos to the trash. photos.json is written first (so it never points at a missing
   * file), then the files move, then the trash list is saved, even if a file move failed, so
   * every removed photo stays restorable.
   */
  const remove = ({ ids }: IdsBody) =>
    change(async () => {
      const { list, removals } = removePhotos(await storage.readPhotos(), ids);
      await storage.writePhotos(list);
      const deletedAt = new Date().toISOString();
      const entries: TrashEntry[] = removals.map(({ record, placement }) => ({
        record,
        deletedAt,
        ...placement,
      }));
      try {
        await moveAll(ids, storage.moveToTrash);
      } finally {
        const trash = await storage.readTrash();
        await storage.writeTrash([...trash.filter((t) => !ids.includes(t.record.id)), ...entries]);
      }
    });

  /** Restore photos from the trash, each back where it was. Files first, then photos.json. */
  const restore = ({ ids }: IdsBody) =>
    change(async () => {
      const trash = await storage.readTrash();
      const missing = ids.filter((id) => !trash.some((t) => t.record.id === id));
      if (missing.length)
        throw new HttpError(
          404,
          "not_found",
          "Some of those photos aren't in the trash any more. Reload the page.",
        );
      // Oldest deletion first: restorePhotos undoes them in reverse, which rebuilds the order exactly.
      const entries = trash.filter((t) => ids.includes(t.record.id));
      const removals = entries.map(({ record, afterId, index }) => ({
        // The project may have been removed from the site since; fall back to the first one.
        record: { ...record, project: categoryOf.has(record.project) ? record.project : projectSlugs[0] },
        placement: { afterId, index },
      }));
      const list = restorePhotos(await storage.readPhotos(), removals);
      await moveAll(ids, storage.moveFromTrash);
      await storage.writePhotos(list);
      await storage.writeTrash(trash.filter((t) => !ids.includes(t.record.id)));
    });

  async function upload(form: FormData): Promise<UploadResult> {
    const project = parseProject(form.get("project"));
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0)
      throw new HttpError(400, "invalid", "Choose a photo to upload.");
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

  return { getState, move, arrange, remove, restore, upload, thumb };
}
