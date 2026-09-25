/**
 * Pure operations on the ordered photo list (photos.json). No I/O: every function returns a new
 * array and leaves its input untouched. Order only matters *within* a project (the site orders
 * projects by src/data/projects.ts, and storage writes the file grouped by project), so the
 * functions only promise the right order inside each project.
 *
 * Every batch operation validates all of its ids before changing anything: all or nothing.
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

const STALE_MESSAGE = "The photos changed since this page loaded. Reload and try again.";

/** Check a batch of ids: at least one, no duplicates, and all present in `list`. */
function requireIds(list: readonly PhotoRecord[], ids: readonly number[]): Set<number> {
  const wanted = new Set(ids);
  if (ids.length === 0 || wanted.size !== ids.length) {
    throw new PhotoListError("invalid", "Choose each photo once.");
  }
  const present = new Set(list.map((p) => p.id));
  const missing = ids.filter((id) => !present.has(id));
  if (missing.length) {
    throw new PhotoListError(
      "not_found",
      `Photo ${missing.join(", ")} isn't in the gallery any more. Reload the page.`,
    );
  }
  return wanted;
}

const insertAt = (list: readonly PhotoRecord[], at: number, records: readonly PhotoRecord[]) => [
  ...list.slice(0, at),
  ...records,
  ...list.slice(at),
];

/** Index just after the last photo of `project` (or the very end if the project is empty). */
function endOfProject(list: readonly PhotoRecord[], project: string): number {
  const last = list.findLastIndex((p) => p.project === project);
  return last === -1 ? list.length : last + 1;
}

/**
 * Move photos (from any projects) into `toProject`, keeping their current relative order,
 * right before `beforeId` or at the end of the project when `beforeId` is null. Used by the Move
 * dialog, drag and drop (same or another project) and keyboard reordering.
 */
export function movePhotos(
  list: readonly PhotoRecord[],
  ids: readonly number[],
  toProject: string,
  beforeId: number | null = null,
): PhotoRecord[] {
  const moving = requireIds(list, ids);
  if (beforeId !== null && moving.has(beforeId)) {
    throw new PhotoListError("invalid", "Can't place photos before one of themselves.");
  }
  const rest = list.filter((p) => !moving.has(p.id));
  const records = list.filter((p) => moving.has(p.id)).map((p) => ({ ...p, project: toProject }));
  if (beforeId === null) return insertAt(rest, endOfProject(rest, toProject), records);

  const at = rest.findIndex((p) => p.id === beforeId && p.project === toProject);
  if (at === -1) throw new PhotoListError("stale", STALE_MESSAGE);
  return insertAt(rest, at, records);
}

/** Exact photo order for some projects: project slug → ids (first = cover). */
export type Layout = Record<string, readonly number[]>;

/**
 * Set the exact contents and order of several projects at once (used to undo a move or drag).
 * The layout must contain exactly the photos currently in those projects; anything else means
 * the page is out of date, so refuse.
 */
export function arrangeProjects(list: readonly PhotoRecord[], layout: Layout): PhotoRecord[] {
  const projects = new Set(Object.keys(layout));
  const laidOut = Object.values(layout).flat();
  const current = list.filter((p) => projects.has(p.project));
  const isSamePhotos =
    laidOut.length === current.length &&
    new Set(laidOut).size === laidOut.length &&
    current.every((p) => laidOut.includes(p.id));
  if (!isSamePhotos) throw new PhotoListError("stale", STALE_MESSAGE);

  const byId = new Map(current.map((p) => [p.id, p]));
  let next = list.filter((p) => !projects.has(p.project));
  for (const [project, ids] of Object.entries(layout)) {
    // present: checked against `current` above
    const records = ids.map((id) => ({ ...(byId.get(id) as PhotoRecord), project }));
    next = insertAt(next, endOfProject(next, project), records);
  }
  return next;
}

/** Where a removed photo was, so a restore can put it back exactly. */
export type Placement = {
  /** the previous photo in the same project (null = it was the cover) */
  afterId: number | null;
  /** its index in the whole list */
  index: number;
};
export type Removal = { record: PhotoRecord; placement: Placement };

const previousInProject = (list: readonly PhotoRecord[], index: number, project: string) =>
  list.slice(0, index).findLast((p) => p.project === project)?.id ?? null;

/**
 * Take photos out, remembering where each one was. Removals are recorded one after another, so
 * restoring them in reverse order (restorePhotos) rebuilds the original list exactly.
 */
export function removePhotos(
  list: readonly PhotoRecord[],
  ids: readonly number[],
): { list: PhotoRecord[]; removals: Removal[] } {
  requireIds(list, ids);
  let next = [...list];
  const removals: Removal[] = [];
  for (const id of ids) {
    const index = next.findIndex((p) => p.id === id);
    const record = next[index];
    removals.push({ record, placement: { afterId: previousInProject(next, index, record.project), index } });
    next = next.filter((_, i) => i !== index);
  }
  return { list: next, removals };
}

/**
 * Put one deleted photo back. If nothing around it changed, it returns to the exact same index.
 * Otherwise: right after its old neighbour if that's still in the project, first in its project
 * if it used to be the cover, else at the end of its project.
 */
function restorePhoto(list: readonly PhotoRecord[], { record, placement }: Removal): PhotoRecord[] {
  const { afterId, index } = placement;
  // Same predecessor within the project at the old index = same place in the project's order.
  if (index >= 0 && index <= list.length && previousInProject(list, index, record.project) === afterId) {
    return insertAt(list, index, [record]);
  }
  const anchor =
    afterId === null ? -1 : list.findIndex((p) => p.id === afterId && p.project === record.project);
  if (anchor !== -1) return insertAt(list, anchor + 1, [record]);
  const firstOfProject = list.findIndex((p) => p.project === record.project);
  if (afterId === null && firstOfProject !== -1) return insertAt(list, firstOfProject, [record]);
  return insertAt(list, endOfProject(list, record.project), [record]);
}

/** Restore removals given in the order they were removed (undoes removePhotos exactly). */
export function restorePhotos(list: readonly PhotoRecord[], removals: readonly Removal[]): PhotoRecord[] {
  const present = new Set(list.map((p) => p.id));
  const clash = removals.find((r) => present.has(r.record.id));
  if (clash) throw new PhotoListError("invalid", `Photo ${clash.record.id} is already in the gallery.`);
  return removals.reduceRight<PhotoRecord[]>((acc, removal) => restorePhoto(acc, removal), [...list]);
}

/** Add a newly uploaded photo at the end of its project. */
export function addPhoto(list: readonly PhotoRecord[], record: PhotoRecord): PhotoRecord[] {
  if (list.some((p) => p.id === record.id))
    throw new PhotoListError("invalid", `Photo id ${record.id} is already used.`);
  return insertAt(list, endOfProject(list, record.project), [record]);
}

/** Ids are never reused: one more than the highest id ever seen (gallery, trash, files on disk). */
export function nextPhotoId(usedIds: Iterable<number>): number {
  let max = 0;
  for (const id of usedIds) if (id > max) max = id;
  return max + 1;
}
