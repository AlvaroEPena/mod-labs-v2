// @ts-check
/**
 * Pure list helpers for the UI (no DOM): keyboard steps, predicting a move before the server
 * answers, undo snapshots and selection ranges. Each returns new arrays.
 * @typedef {{ id: number, project: string }} Placed
 */

/**
 * Move `id` to position `to` (clamped) within `ids`.
 * @param {readonly number[]} ids
 * @param {number} id
 * @param {number} to
 * @returns {number[]}
 */
export function moveTo(ids, id, to) {
  if (!ids.includes(id)) return [...ids];
  const rest = ids.filter((x) => x !== id);
  const at = Math.max(0, Math.min(to, rest.length));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * Move `id` by `step` places (-1 = earlier, +1 = later).
 * @param {readonly number[]} ids
 * @param {number} id
 * @param {number} step
 */
export const moveBy = (ids, id, step) => moveTo(ids, id, ids.indexOf(id) + step);

/**
 * The photo that follows `id` in `order` (what the server calls `beforeId`), or null at the end.
 * @param {readonly number[]} order
 * @param {number} id
 * @returns {number | null}
 */
export const idAfter = (order, id) => order[order.indexOf(id) + 1] ?? null;

/**
 * Same rules as the server's moveItems: the photos keep their relative (list) order and land
 * before `beforeId`, or at the end of `project`. Used to re-render immediately after a drop.
 * @template {Placed} P
 * @param {readonly P[]} photos
 * @param {readonly number[]} ids
 * @param {string} project
 * @param {number | null} beforeId
 * @returns {P[]}
 */
export function moveItems(photos, ids, project, beforeId) {
  const moving = new Set(ids);
  const rest = photos.filter((p) => !moving.has(p.id));
  const records = photos.filter((p) => moving.has(p.id)).map((p) => ({ ...p, project }));
  const before = beforeId === null ? -1 : rest.findIndex((p) => p.id === beforeId);
  const last = rest.findLastIndex((p) => p.project === project);
  const at = before !== -1 ? before : last === -1 ? rest.length : last + 1;
  return [...rest.slice(0, at), ...records, ...rest.slice(at)];
}

/**
 * Snapshot of some projects' exact contents (for undo via /api/arrange).
 * @param {readonly Placed[]} photos
 * @param {Iterable<string>} projects
 * @returns {Record<string, number[]>}
 */
export function layoutOf(photos, projects) {
  return Object.fromEntries(
    [...new Set(projects)].map((slug) => [slug, photos.filter((p) => p.project === slug).map((p) => p.id)]),
  );
}

/**
 * @param {Record<string, number[]>} a
 * @param {Record<string, number[]>} b
 */
export const sameLayout = (a, b) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([slug, ids]) => {
    const other = b[slug];
    return other !== undefined && other.length === ids.length && ids.every((id, i) => other[i] === id);
  });

/**
 * Every id from `from` to `to` inclusive, in `order` (Shift-click ranges). Empty if either is missing.
 * @param {readonly number[]} order
 * @param {number} from
 * @param {number} to
 * @returns {number[]}
 */
export function idsBetween(order, from, to) {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a === -1 || b === -1) return [];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}
