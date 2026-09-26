/**
 * Pure operations on an ordered list of gallery items (photos.json or videos.json): anything with
 * an `id` and a `project`. No I/O: every function returns a new array and leaves its input
 * untouched. Order only matters *within* a project (the site orders projects by
 * src/data/projects.ts, and storage writes the files grouped by project).
 *
 * Every batch operation validates all of its ids before changing anything: all or nothing.
 * Messages say "item"; the handlers put them in context.
 */

/** The minimum an item needs. */
export type Item = { id: number; project: string };

export type ListErrorCode = "not_found" | "stale" | "invalid";

/** A request that doesn't fit the current list. `code` maps to an HTTP status in the handlers. */
export class ListError extends Error {
  name = "ListError";
  code: ListErrorCode;
  constructor(code: ListErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const STALE_MESSAGE = "The gallery changed since this page loaded. Reload and try again.";

/** Check a batch of ids: at least one, no duplicates, and all present in `list`. */
function requireIds(list: readonly Item[], ids: readonly number[]): Set<number> {
  const wanted = new Set(ids);
  if (ids.length === 0 || wanted.size !== ids.length) {
    throw new ListError("invalid", "Choose each item once.");
  }
  const present = new Set(list.map((p) => p.id));
  const missing = ids.filter((id) => !present.has(id));
  if (missing.length) {
    throw new ListError(
      "not_found",
      `Item ${missing.join(", ")} isn't in the gallery any more. Reload the page.`,
    );
  }
  return wanted;
}

const insertAt = <T>(list: readonly T[], at: number, records: readonly T[]) => [
  ...list.slice(0, at),
  ...records,
  ...list.slice(at),
];

/** Index just after the last item of `project` (or the very end if the project is empty). */
function endOfProject(list: readonly Item[], project: string): number {
  const last = list.findLastIndex((p) => p.project === project);
  return last === -1 ? list.length : last + 1;
}

/**
 * Move items (from any projects) into `toProject`, keeping their current relative order,
 * right before `beforeId` or at the end of the project when `beforeId` is null. Used by the Move
 * dialog, drag and drop (same or another project) and keyboard reordering.
 */
export function moveItems<T extends Item>(
  list: readonly T[],
  ids: readonly number[],
  toProject: string,
  beforeId: number | null = null,
): T[] {
  const moving = requireIds(list, ids);
  if (beforeId !== null && moving.has(beforeId)) {
    throw new ListError("invalid", "Can't place items before one of themselves.");
  }
  const rest = list.filter((p) => !moving.has(p.id));
  const records = list.filter((p) => moving.has(p.id)).map((p) => ({ ...p, project: toProject }));
  if (beforeId === null) return insertAt(rest, endOfProject(rest, toProject), records);

  const at = rest.findIndex((p) => p.id === beforeId && p.project === toProject);
  if (at === -1) throw new ListError("stale", STALE_MESSAGE);
  return insertAt(rest, at, records);
}

/** Exact order for some projects: project slug → ids (for photos, first = cover). */
export type Layout = Record<string, readonly number[]>;

/**
 * Set the exact contents and order of several projects at once (used to undo a move or drag).
 * The layout must contain exactly the items currently in those projects; anything else means
 * the page is out of date, so refuse.
 */
export function arrangeProjects<T extends Item>(list: readonly T[], layout: Layout): T[] {
  const projects = new Set(Object.keys(layout));
  const laidOut = Object.values(layout).flat();
  const current = list.filter((p) => projects.has(p.project));
  const isSameItems =
    laidOut.length === current.length &&
    new Set(laidOut).size === laidOut.length &&
    current.every((p) => laidOut.includes(p.id));
  if (!isSameItems) throw new ListError("stale", STALE_MESSAGE);

  const byId = new Map(current.map((p) => [p.id, p]));
  let next = list.filter((p) => !projects.has(p.project));
  for (const [project, ids] of Object.entries(layout)) {
    // present: checked against `current` above
    const records = ids.map((id) => ({ ...(byId.get(id) as T), project }));
    next = insertAt(next, endOfProject(next, project), records);
  }
  return next;
}

/** Where a removed item was, so a restore can put it back exactly. */
export type Placement = {
  /** the previous item in the same project (null = it was first) */
  afterId: number | null;
  /** its index in the whole list */
  index: number;
};
export type Removal<T extends Item> = { record: T; placement: Placement };

const previousInProject = (list: readonly Item[], index: number, project: string) =>
  list.slice(0, index).findLast((p) => p.project === project)?.id ?? null;

/**
 * Take items out, remembering where each one was. Removals are recorded one after another, so
 * restoring them in reverse order (restoreItems) rebuilds the original list exactly.
 */
export function removeItems<T extends Item>(
  list: readonly T[],
  ids: readonly number[],
): { list: T[]; removals: Removal<T>[] } {
  requireIds(list, ids);
  let next = [...list];
  const removals: Removal<T>[] = [];
  for (const id of ids) {
    const index = next.findIndex((p) => p.id === id);
    const record = next[index];
    removals.push({ record, placement: { afterId: previousInProject(next, index, record.project), index } });
    next = next.filter((_, i) => i !== index);
  }
  return { list: next, removals };
}

/**
 * Put one deleted item back. If nothing around it changed, it returns to the exact same index.
 * Otherwise: right after its old neighbour if that's still in the project, first in its project
 * if it used to be first, else at the end of its project.
 */
function restoreOne<T extends Item>(list: readonly T[], { record, placement }: Removal<T>): T[] {
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

/** Restore removals given in the order they were removed (undoes removeItems exactly). */
export function restoreItems<T extends Item>(list: readonly T[], removals: readonly Removal<T>[]): T[] {
  const present = new Set(list.map((p) => p.id));
  const clash = removals.find((r) => present.has(r.record.id));
  if (clash) throw new ListError("invalid", `Item ${clash.record.id} is already in the gallery.`);
  return removals.reduceRight<T[]>((acc, removal) => restoreOne(acc, removal), [...list]);
}

/** Add a new item at the end of its project. */
export function addItem<T extends Item>(list: readonly T[], record: T): T[] {
  if (list.some((p) => p.id === record.id))
    throw new ListError("invalid", `Id ${record.id} is already used.`);
  return insertAt(list, endOfProject(list, record.project), [record]);
}

/** Ids are never reused: one more than the highest id ever seen (list, trash, files on disk). */
export function nextId(usedIds: Iterable<number>): number {
  let max = 0;
  for (const id of usedIds) if (id > max) max = id;
  return max + 1;
}
