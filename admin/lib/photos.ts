/**
 * Pure operations on the ordered photo list (photos.json). No I/O: every function returns a new
 * array and leaves its input untouched. The list is global, but order only matters *within* a
 * project (project order on the site comes from `projects` in src/data/projects.ts), so new or
 * moved photos go to the end of their project's run.
 */
import type { PhotoRecord } from "./types.ts";

export type ListErrorCode = "not_found" | "stale" | "invalid";

/** A request that doesn't fit the current list. `code` maps to an HTTP status in the handlers. */
export class PhotoListError extends Error {
  name = "PhotoListError";
  code: ListErrorCode;
  constructor(code: ListErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const indexOfId = (list: readonly PhotoRecord[], id: number) => {
  const index = list.findIndex((p) => p.id === id);
  if (index === -1)
    throw new PhotoListError("not_found", `Photo ${id} isn't in the gallery any more. Reload the page.`);
  return index;
};

export const findPhoto = (list: readonly PhotoRecord[], id: number) => list[indexOfId(list, id)];

/** Insert after the last photo of `record.project` (or at the very end if the project is empty). */
function appendToProject(list: readonly PhotoRecord[], record: PhotoRecord): PhotoRecord[] {
  const lastIndex = list.findLastIndex((p) => p.project === record.project);
  const at = lastIndex === -1 ? list.length : lastIndex + 1;
  return [...list.slice(0, at), record, ...list.slice(at)];
}

/**
 * Put one project's photos in the given order. `orderedIds` must be exactly the project's current
 * ids; anything else means the page is out of date (another tab, a hand edit), so refuse.
 */
export function reorderProject(
  list: readonly PhotoRecord[],
  project: string,
  orderedIds: readonly number[],
): PhotoRecord[] {
  const slots = list.flatMap((p, i) => (p.project === project ? [i] : []));
  const current = new Set(slots.map((i) => list[i].id));
  const isSamePhotos =
    orderedIds.length === current.size &&
    new Set(orderedIds).size === orderedIds.length &&
    orderedIds.every((id) => current.has(id));
  if (!isSamePhotos)
    throw new PhotoListError("stale", "The photo list changed since this page loaded. Reload and try again.");

  const byId = new Map(list.map((p) => [p.id, p]));
  const next = [...list];
  slots.forEach((slot, i) => {
    next[slot] = byId.get(orderedIds[i]) as PhotoRecord; // present: checked against `current` above
  });
  return next;
}

/** Move a photo to another project; it becomes that project's last photo. */
export function movePhoto(list: readonly PhotoRecord[], id: number, toProject: string): PhotoRecord[] {
  const index = indexOfId(list, id);
  const photo = list[index];
  if (photo.project === toProject) return [...list];
  const without = list.filter((_, i) => i !== index);
  return appendToProject(without, { ...photo, project: toProject });
}

/** Where a removed photo was, so a restore can put it back exactly. */
export type Placement = {
  /** the previous photo in the same project (null = it was the cover) */
  afterId: number | null;
  /** its index in the whole list */
  index: number;
};
export type Removal = { list: PhotoRecord[]; removed: PhotoRecord; placement: Placement };

const previousInProject = (list: readonly PhotoRecord[], index: number, project: string) =>
  list.slice(0, index).findLast((p) => p.project === project)?.id ?? null;

const insertAt = (list: readonly PhotoRecord[], at: number, record: PhotoRecord) => [
  ...list.slice(0, at),
  record,
  ...list.slice(at),
];

/** Take a photo out, remembering where it was so a restore can put it back in place. */
export function removePhoto(list: readonly PhotoRecord[], id: number): Removal {
  const index = indexOfId(list, id);
  const removed = list[index];
  return {
    list: list.filter((_, i) => i !== index),
    removed,
    placement: { afterId: previousInProject(list, index, removed.project), index },
  };
}

/**
 * Put a deleted photo back. If nothing around it changed, it returns to the exact same index
 * (photos.json is then byte-identical). Otherwise: right after its old neighbour if that's still
 * in the project, first in its project if it used to be the cover, else at the end of its project.
 */
export function restorePhoto(
  list: readonly PhotoRecord[],
  record: PhotoRecord,
  placement: Placement,
): PhotoRecord[] {
  if (list.some((p) => p.id === record.id))
    throw new PhotoListError("invalid", `Photo ${record.id} is already in the gallery.`);
  const { afterId, index } = placement;

  // Same predecessor within the project at the old index = same place in the project's order.
  if (index >= 0 && index <= list.length && previousInProject(list, index, record.project) === afterId) {
    return insertAt(list, index, record);
  }
  const anchor =
    afterId === null ? -1 : list.findIndex((p) => p.id === afterId && p.project === record.project);
  if (anchor !== -1) return insertAt(list, anchor + 1, record);
  const firstOfProject = list.findIndex((p) => p.project === record.project);
  if (afterId === null && firstOfProject !== -1) return insertAt(list, firstOfProject, record);
  return appendToProject(list, record);
}

/** Add a newly uploaded photo at the end of its project. */
export function addPhoto(list: readonly PhotoRecord[], record: PhotoRecord): PhotoRecord[] {
  if (list.some((p) => p.id === record.id))
    throw new PhotoListError("invalid", `Photo id ${record.id} is already used.`);
  return appendToProject(list, record);
}

/** Ids are never reused: one more than the highest id ever seen (gallery, trash, files on disk). */
export function nextPhotoId(usedIds: Iterable<number>): number {
  let max = 0;
  for (const id of usedIds) if (id > max) max = id;
  return max + 1;
}
