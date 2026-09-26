// @ts-check
/**
 * Wires the per-project "Videos" strips: play, reorder (drag, arrow buttons, arrow keys on the
 * poster button), rename, poster, move, delete and "Add a video". All changes go through the shared
 * queue, each with an announcement and Undo.
 * @typedef {import("../lib/types.ts").AdminState} AdminState
 * @typedef {import("../lib/types.ts").AdminVideo} AdminVideo
 * @typedef {import("./actions.js").FocusTarget} FocusTarget
 * @typedef {import("./queue.js").Enqueue} Enqueue
 */
import { createActions } from "./actions.js";
import { post } from "./api.js";
import { chooseProject, confirmDelete } from "./dialogs.js";
import { moveBy, moveTo } from "./order.js";
import { setupSortable } from "./sortable.js";
import { announce } from "./toast.js";
import { choosePoster, playVideo, renameVideo } from "./video-dialogs.js";
import { setupVideoUpload } from "./video-upload.js";

/**
 * @param {{
 *   root: HTMLElement,
 *   enqueue: Enqueue,
 *   getState: () => AdminState | undefined,
 *   applyState: (next: AdminState, focus?: FocusTarget) => void,
 *   reload: () => Promise<void>,
 * }} deps
 */
export function setupVideoControls({ root, enqueue, getState, applyState, reload }) {
  const actions = createActions({ kind: "videos", enqueue, applyState });
  const uploads = setupVideoUpload({
    getState,
    onAdded: async (id) => {
      await reload();
      const card = root.querySelector(`.vcard[data-id="${id}"]`);
      card?.classList.add("is-flash");
      card?.scrollIntoView({ block: "nearest" });
    },
    announce: (message, isError) => announce(message, { isError }),
  });

  const videoOf = (/** @type {number} */ id) => getState()?.videos.find((v) => v.id === id);
  const posterIds = (/** @type {AdminVideo[]} */ videos) =>
    videos.flatMap((v) => (v.posterThumbId === null ? [] : [v.posterThumbId]));

  /**
   * Save a title/poster change, with Undo back to the previous values.
   * @param {AdminVideo} video
   * @param {{ title?: string, posterId?: number | null }} changes
   * @param {string} message
   */
  function update(video, changes, message) {
    const previous = {
      ...(changes.title === undefined ? {} : { title: video.title }),
      ...(changes.posterId === undefined ? {} : { posterId: video.posterId ?? null }),
    };
    return enqueue(async () => {
      applyState(await post("videos/update", { id: video.id, ...changes }), {
        id: video.id,
        moveFocus: true,
        kind: "videos",
      });
      announce(message, {
        action: {
          label: "Undo",
          run: () =>
            enqueue(async () => {
              applyState(await post("videos/update", { id: video.id, ...previous }));
              announce("Undone.");
            }),
        },
      });
    });
  }

  root.addEventListener("click", async (e) => {
    const button = e.target instanceof Element ? e.target.closest(".videos button[data-action]") : null;
    if (!(button instanceof HTMLButtonElement)) return;
    const state = getState();
    if (!state) return;
    const { action } = button.dataset;
    if (action === "add-video") return uploads.openFor(button.dataset.project ?? "");
    const video = videoOf(Number(button.closest(".vcard")?.getAttribute("data-id")));
    if (!video) return;
    if (action === "play") playVideo(video);
    else if (action === "earlier") actions.step(video.id, (order) => moveBy(order, video.id, -1));
    else if (action === "later") actions.step(video.id, (order) => moveBy(order, video.id, 1));
    else if (action === "rename") {
      const title = await renameVideo(video);
      if (title) await update(video, { title }, `Renamed to "${title}".`);
    } else if (action === "poster") {
      const posterId = await choosePoster(state, video);
      if (posterId !== undefined) {
        await update(
          video,
          { posterId },
          posterId === null ? "Poster set to automatic (project cover)." : "Poster changed.",
        );
      }
    } else if (action === "move") {
      const subject = {
        count: 1,
        noun: /** @type {const} */ ("video"),
        thumbIds: posterIds([video]),
        fromProjects: [video.project],
      };
      const project = await chooseProject(state, subject);
      if (project) await actions.move([video.id], project, null);
    } else if (action === "delete") {
      if (await confirmDelete({ count: 1, noun: "video", thumbIds: posterIds([video]) }))
        await actions.remove([video.id]);
    }
  });

  /** With the poster button focused: arrows move the video, Home/End to first/last. */
  root.addEventListener("keydown", (e) => {
    const handle = e.target instanceof Element ? e.target.closest('.vcard [data-action="play"]') : null;
    if (!handle) return;
    const id = Number(handle.closest(".vcard")?.getAttribute("data-id"));
    /** @type {Record<string, (order: number[]) => number[]>} */
    const moves = {
      ArrowLeft: (order) => moveBy(order, id, -1),
      ArrowUp: (order) => moveBy(order, id, -1),
      ArrowRight: (order) => moveBy(order, id, 1),
      ArrowDown: (order) => moveBy(order, id, 1),
      Home: (order) => moveTo(order, id, 0),
      End: (order) => moveTo(order, id, order.length),
    };
    const reorder = moves[e.key];
    if (!reorder) return;
    e.preventDefault();
    actions.step(id, reorder);
  });

  setupSortable(root, {
    item: ".vcard",
    list: ".video-list",
    dragIds: (id) => [id],
    onDrop: ({ ids, project, beforeId }) => actions.move(ids, project, beforeId),
    onCancel: () => announce("Drag cancelled. Nothing changed."),
  });

  return {
    restore: actions.restore,
    isBusy: uploads.isBusy,
  };
}
