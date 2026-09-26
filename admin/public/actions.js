// @ts-check
/**
 * Every change to photos or videos, with its announcement and Undo. One factory, two kinds: they
 * differ only in which list of the state they touch, the API prefix, and the wording.
 * Changes go through the shared queue (see queue.js).
 * @typedef {import("../lib/types.ts").AdminState} AdminState
 * @typedef {import("./queue.js").Enqueue} Enqueue
 * @typedef {{ id: number, moveFocus: boolean, kind?: Kind }} FocusTarget
 * @typedef {"photos" | "videos"} Kind
 * @typedef {{
 *   kind: Kind,
 *   enqueue: Enqueue,
 *   applyState: (next: AdminState, focus?: FocusTarget) => void,
 * }} ActionDeps
 */
import { post } from "./api.js";
import { plural } from "./dom.js";
import { idAfter, layoutOf, moveItems, sameLayout } from "./order.js";
import { projectTitles } from "./render.js";
import { announce } from "./toast.js";

/** @type {Record<Kind, { api: "" | "videos/", noun: string, firstIs: string }>} */
const KINDS = {
  photos: { api: "", noun: "photo", firstIs: "the cover" },
  videos: { api: "videos/", noun: "video", firstIs: "first" },
};

/** @param {ActionDeps} deps */
export function createActions({ kind, enqueue, applyState }) {
  const { api, noun, firstIs } = KINDS[kind];
  /** @returns {{ id: number, project: string }[]} this kind's items, in display order */
  const listOf = (/** @type {AdminState} */ state) => (kind === "photos" ? state.photos : state.videos);
  /** Replace this kind's list in a state (for showing a predicted order before saving). */
  const withList = (/** @type {AdminState} */ state, /** @type {{ id: number, project: string }[]} */ list) =>
    /** @type {AdminState} */ (kind === "photos" ? { ...state, photos: list } : { ...state, videos: list });
  const focusOn = (/** @type {number} */ id, /** @type {boolean} */ moveFocus) => ({ id, moveFocus, kind });

  const titleOf = (/** @type {AdminState} */ state, /** @type {string} */ slug) =>
    projectTitles(state).get(slug) ?? slug;
  const projectsOf = (/** @type {AdminState} */ state, /** @type {readonly number[]} */ ids) =>
    listOf(state)
      .filter((p) => ids.includes(p.id))
      .map((p) => p.project);

  /** Undo for moves/drags: put the affected projects back exactly as they were. */
  const undoLayout = (/** @type {Record<string, number[]>} */ layout) => ({
    label: "Undo",
    run: () =>
      enqueue(async () => {
        applyState(await post(`${api}arrange`, { layout }));
        announce(`Undone. The ${noun}s are back where they were.`);
      }),
  });

  /**
   * Move items into `project` before `beforeId` (null = at the end). Shows the new order right
   * away (same rules as the server), then saves it with one request. Runs inside a queued task.
   * @param {AdminState} state
   * @param {readonly number[]} ids
   * @param {string} project
   * @param {number | null} beforeId
   * @param {{ focus: boolean, withUndo: boolean }} options
   */
  async function applyMove(state, ids, project, beforeId, { focus, withUndo }) {
    const affected = [...projectsOf(state, ids), project];
    const before = layoutOf(listOf(state), affected);
    const predicted = moveItems(listOf(state), ids, project, beforeId);
    const after = layoutOf(predicted, affected);
    if (sameLayout(before, after)) return; // dropped where it already was
    applyState(withList(state, predicted), focusOn(ids[0], focus));

    const saved = await post(`${api}move`, { ids: [...ids], project, beforeId });
    applyState(saved, focusOn(ids[0], focus));
    const order = after[project];
    const position = order.indexOf(ids[0]);
    const isReorder = projectsOf(state, ids).every((p) => p === project);
    const message =
      isReorder && ids.length === 1
        ? `Saved. ${position === 0 ? `Now ${firstIs} in ${titleOf(state, project)}` : `Position ${position + 1} of ${order.length}`}.`
        : isReorder
          ? `Saved. ${plural(ids.length, noun)} reordered in ${titleOf(state, project)}.`
          : `Saved. Moved ${plural(ids.length, noun)} to ${titleOf(state, project)}.`;
    announce(message, withUndo ? { action: undoLayout(before) } : {});
  }

  /**
   * Drag and drop, or the Move dialog.
   * @param {readonly number[]} ids
   * @param {string} project
   * @param {number | null} beforeId
   */
  const move = (ids, project, beforeId) =>
    enqueue((state) => applyMove(state, ids, project, beforeId, { focus: false, withUndo: true }));

  /**
   * Keyboard / arrow-button reordering of one item within its project. Focus stays on it.
   * Computed when its turn in the queue comes, so fast repeated presses all count.
   * @param {number} id
   * @param {(order: number[]) => number[]} reorder
   */
  const step = (id, reorder) =>
    enqueue(async (state) => {
      const item = listOf(state).find((p) => p.id === id);
      if (!item) return;
      const order = listOf(state)
        .filter((p) => p.project === item.project)
        .map((p) => p.id);
      const next = reorder(order);
      await applyMove(state, [id], item.project, idAfter(next, id), { focus: true, withUndo: false });
    });

  /** @param {readonly number[]} ids */
  function remove(ids) {
    return enqueue(async (state) => {
      const from = [...new Set(projectsOf(state, ids))];
      applyState(await post(`${api}delete`, { ids: [...ids] }));
      const where = from.length === 1 ? ` from ${titleOf(state, from[0])}` : "";
      announce(`Moved ${plural(ids.length, noun)} to the trash${where}.`, {
        action: { label: "Undo", run: () => restore(ids) },
      });
    });
  }

  /** @param {readonly number[]} ids */
  function restore(ids) {
    return enqueue(async () => {
      const next = await post(`${api}restore`, { ids: [...ids] });
      applyState(next, focusOn(ids[0], false));
      announce(`Restored ${plural(ids.length, noun)}.`);
    });
  }

  return { move, step, remove, restore };
}
