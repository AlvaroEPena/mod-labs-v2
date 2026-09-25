// @ts-check
/**
 * Pure helpers that compute a project's new photo order (the server then saves the whole order).
 * Each returns a new array; an unknown id returns the input order unchanged.
 */

/**
 * Move `id` to position `to` (clamped to the list).
 * @param {readonly number[]} ids
 * @param {number} id
 * @param {number} to
 * @returns {number[]}
 */
export function moveTo(ids, id, to) {
  const from = ids.indexOf(id);
  if (from === -1) return [...ids];
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
 * Drag and drop: put `dragged` just before (or after) `target`.
 * @param {readonly number[]} ids
 * @param {number} dragged
 * @param {number} target
 * @param {boolean} after
 * @returns {number[]}
 */
export function placeNextTo(ids, dragged, target, after) {
  if (dragged === target || !ids.includes(dragged) || !ids.includes(target)) return [...ids];
  const rest = ids.filter((x) => x !== dragged);
  const at = rest.indexOf(target) + (after ? 1 : 0);
  return [...rest.slice(0, at), dragged, ...rest.slice(at)];
}

/**
 * @param {readonly number[]} a
 * @param {readonly number[]} b
 */
export const sameOrder = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
