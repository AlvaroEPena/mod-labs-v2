// @ts-check
/**
 * One queue for every change the admin makes (photos and videos), so changes run one after
 * another and each works from the latest state when its turn comes. Errors are announced; if the
 * page turns out to be out of date (404/409), it reloads.
 * @typedef {import("../lib/types.ts").AdminState} AdminState
 * @typedef {(task: (state: AdminState) => Promise<void>) => Promise<void>} Enqueue
 */
import { ApiRequestError } from "./api.js";
import { announce } from "./toast.js";

/**
 * @param {{ getState: () => AdminState | undefined, onReloadNeeded: () => Promise<void> }} deps
 * @returns {Enqueue}
 */
export function createQueue({ getState, onReloadNeeded }) {
  /** @type {Promise<void>} */
  let queue = Promise.resolve();
  return (task) => {
    const run = queue.then(async () => {
      const state = getState();
      if (!state) return;
      try {
        await task(state);
      } catch (err) {
        announce(err instanceof Error ? err.message : "That didn't work.", { isError: true });
        if (err instanceof ApiRequestError && [404, 409].includes(err.status)) await onReloadNeeded();
      }
    });
    queue = run;
    return run;
  };
}
