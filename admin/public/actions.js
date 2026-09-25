// @ts-check
/**
 * Every change the admin makes, with its announcement and Undo. Changes run one after another
 * through a queue (so fast arrow-key presses are never dropped), and each works from the latest
 * state when its turn comes.
 * @typedef {import("../lib/types.ts").AdminState} AdminState
 * @typedef {import("./sortable.js").DropResult} DropResult
 * @typedef {{ id: number, moveFocus: boolean }} FocusTarget
 * @typedef {{
 *   getState: () => AdminState | undefined,
 *   applyState: (next: AdminState, focus?: FocusTarget) => void,
 *   onReloadNeeded: () => Promise<void>,
 * }} ActionDeps
 */
import { ApiRequestError, post } from "./api.js";
import { plural } from "./dom.js";
import { idAfter, layoutOf, movePhotos, sameLayout } from "./order.js";
import { projectTitles } from "./render.js";
import { announce } from "./toast.js";

/** @param {ActionDeps} deps */
export function createActions({ getState, applyState, onReloadNeeded }) {
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();

  /**
   * Queue a change. `task` gets the current state (skipped if nothing is loaded yet).
   * @param {(state: AdminState) => Promise<void>} task
   */
  function enqueue(task) {
    const run = queue.then(async () => {
      const state = getState();
      if (!state) return;
      try {
        await task(state);
      } catch (err) {
        announce(err instanceof Error ? err.message : "That didn't work.", { isError: true });
        // Out of date (another tab, a restart): reload so the page matches the disk again.
        if (err instanceof ApiRequestError && [404, 409].includes(err.status)) await onReloadNeeded();
      }
    });
    queue = run;
    return run;
  }

  const titleOf = (/** @type {AdminState} */ state, /** @type {string} */ slug) =>
    projectTitles(state).get(slug) ?? slug;
  const projectsOf = (/** @type {AdminState} */ state, /** @type {readonly number[]} */ ids) =>
    state.photos.filter((p) => ids.includes(p.id)).map((p) => p.project);

  /** Undo for moves/drags: put the affected projects back exactly as they were. */
  const undoLayout = (/** @type {Record<string, number[]>} */ layout) => ({
    label: "Undo",
    run: () =>
      enqueue(async () => {
        applyState(await post("arrange", { layout }));
        announce("Undone. The photos are back where they were.");
      }),
  });

  /**
   * Move photos into `project` before `beforeId` (null = at the end). Shows the new order right
   * away (same rules as the server), then saves it with one request. Runs inside a queued task.
   * @param {AdminState} state
   * @param {readonly number[]} ids
   * @param {string} project
   * @param {number | null} beforeId
   * @param {{ focus: boolean, withUndo: boolean }} options
   */
  async function applyMove(state, ids, project, beforeId, { focus, withUndo }) {
    const affected = [...projectsOf(state, ids), project];
    const before = layoutOf(state.photos, affected);
    const predicted = movePhotos(state.photos, ids, project, beforeId);
    const after = layoutOf(predicted, affected);
    if (sameLayout(before, after)) return; // dropped where it already was
    applyState({ ...state, photos: predicted }, { id: ids[0], moveFocus: focus });

    const saved = await post("move", { ids: [...ids], project, beforeId });
    applyState(saved, { id: ids[0], moveFocus: focus });
    const order = after[project];
    const position = order.indexOf(ids[0]);
    const isReorder = projectsOf(state, ids).every((p) => p === project);
    const message =
      isReorder && ids.length === 1
        ? `Saved. ${position === 0 ? `Now the cover of ${titleOf(state, project)}` : `Position ${position + 1} of ${order.length}`}.`
        : isReorder
          ? `Saved. ${plural(ids.length, "photo")} reordered in ${titleOf(state, project)}.`
          : `Saved. Moved ${plural(ids.length, "photo")} to ${titleOf(state, project)}.`;
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
   * Keyboard / arrow-button reordering of one photo within its project. Focus stays on it.
   * Computed when its turn in the queue comes, so fast repeated presses all count.
   * @param {number} id
   * @param {(order: number[]) => number[]} reorder
   */
  const step = (id, reorder) =>
    enqueue(async (state) => {
      const photo = state.photos.find((p) => p.id === id);
      if (!photo) return;
      const order = state.photos.filter((p) => p.project === photo.project).map((p) => p.id);
      const next = reorder(order);
      await applyMove(state, [id], photo.project, idAfter(next, id), { focus: true, withUndo: false });
    });

  /** @param {readonly number[]} ids */
  function remove(ids) {
    return enqueue(async (state) => {
      const from = [...new Set(projectsOf(state, ids))];
      applyState(await post("delete", { ids: [...ids] }));
      const where = from.length === 1 ? ` from ${titleOf(state, from[0])}` : "";
      announce(`Moved ${plural(ids.length, "photo")} to the trash${where}.`, {
        action: { label: "Undo", run: () => restore(ids) },
      });
    });
  }

  /** @param {readonly number[]} ids */
  function restore(ids) {
    return enqueue(async () => {
      const next = await post("restore", { ids: [...ids] });
      applyState(next, { id: ids[0], moveFocus: false });
      announce(`Restored ${plural(ids.length, "photo")}.`);
    });
  }

  return { move, step, remove, restore };
}
