// @ts-check
/**
 * Photo & video admin UI controller: loads state, renders it, and wires photo input (click,
 * keyboard, drag, selection bars, views) to the actions; video input is wired in
 * video-controls.js. Focus and highlights follow the item being worked on.
 * @typedef {import("../lib/types.ts").AdminState} AdminState
 * @typedef {import("./actions.js").FocusTarget} FocusTarget
 */
import { createActions } from "./actions.js";
import { getState } from "./api.js";
import { chooseProject, confirmDelete } from "./dialogs.js";
import { h } from "./dom.js";
import { moveBy, moveTo } from "./order.js";
import { createQueue } from "./queue.js";
import { fillProjectSelect, renderBanner, renderGallery } from "./render.js";
import { createSelection } from "./select.js";
import { syncSelection } from "./selection-ui.js";
import { setupSortable } from "./sortable.js";
import { announce } from "./toast.js";
import { renderTrash } from "./trash.js";
import { setupUpload } from "./upload.js";
import { setupVideoControls } from "./video-controls.js";

const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const galleryEl = byId("gallery");
const trashEl = byId("trash");
const galleryBar = byId("selection-bar");
const trashBar = byId("trash-bar");
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** @type {AdminState | undefined} */
let state;
/** @type {"gallery" | "trash"} */
let view = "gallery";

const selection = createSelection(syncSelections);
const trashSelection = createSelection(syncSelections);

function syncSelections() {
  syncSelection(galleryEl, selection, galleryBar, view === "gallery");
  syncSelection(trashEl, trashSelection, trashBar, view === "trash");
}

/**
 * Render a new state. With `focus`, highlight that photo and (optionally) keep keyboard focus on
 * it, scrolled smoothly into view, so it's easy to follow while it moves.
 * @param {AdminState} next
 * @param {FocusTarget} [focus]
 */
function applyState(next, focus) {
  state = next;
  selection.prune(next.photos.map((p) => p.id));
  trashSelection.prune(next.trash.map((t) => t.id));
  renderGallery(galleryEl, byId("jump"), next);
  renderTrash(trashEl, next);
  renderBanner(byId("banner"), next.pending);
  byId("trash-count").textContent = String(next.trash.length + next.videoTrash.length);
  fillProjectSelect(/** @type {HTMLSelectElement} */ (byId("upload-project")), next, {
    placeholder: "Choose a project…",
  });
  syncSelections();
  if (!focus) return;
  const selector = focus.kind === "videos" ? ".vcard" : ".card";
  const card = galleryEl.querySelector(`${selector}[data-id="${focus.id}"]`);
  if (!(card instanceof HTMLElement)) return;
  card.classList.add("is-flash");
  if (!focus.moveFocus) return;
  card.querySelector("button")?.focus({ preventScroll: true }); // the first button is the photo/poster handle
  card.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

async function load() {
  try {
    applyState(await getState());
  } catch (err) {
    const retry = h("button", { type: "button", class: "btn" }, "Try again");
    retry.addEventListener("click", load);
    galleryEl.replaceChildren(
      h("p", { class: "empty" }, err instanceof Error ? err.message : "Couldn't load the photos."),
      retry,
    );
  }
}

const enqueue = createQueue({ getState: () => state, onReloadNeeded: load });
const actions = createActions({ kind: "photos", enqueue, applyState });
const videoControls = setupVideoControls({
  root: galleryEl,
  enqueue,
  getState: () => state,
  applyState,
  reload: load,
});
const uploads = setupUpload({
  getState: () => state,
  onUploaded: (next, id) => applyState(next, { id, moveFocus: false }),
  announce: (message, isError) => announce(message, { isError }),
});

/* ---------- helpers ---------- */

const idOf = (/** @type {Element} */ el) => Number(el.closest(".card")?.getAttribute("data-id"));
const idsIn = (/** @type {string} */ project) =>
  (state?.photos ?? []).filter((p) => p.project === project).map((p) => p.id);
const projectOf = (/** @type {number} */ id) => state?.photos.find((p) => p.id === id)?.project ?? "";
const displayOrder = () => (state?.photos ?? []).map((p) => p.id);

/**
 * Click or Space on a photo: toggle it, or with Shift select the range from the last one clicked.
 * @param {number} id
 * @param {boolean} isRange
 */
function select(id, isRange) {
  if (isRange) selection.extendTo(idsIn(projectOf(id)), id);
  else selection.toggle(id);
}

/** @param {readonly number[]} ids */
async function moveWithDialog(ids) {
  if (!state || ids.length === 0) return;
  const fromProjects = state.photos.filter((p) => ids.includes(p.id)).map((p) => p.project);
  const project = await chooseProject(state, {
    count: ids.length,
    noun: "photo",
    thumbIds: ids,
    fromProjects,
  });
  if (!project) return;
  selection.clear();
  await actions.move(ids, project, null);
}

/** @param {readonly number[]} ids */
async function deleteWithConfirm(ids) {
  if (ids.length === 0 || !(await confirmDelete({ count: ids.length, noun: "photo", thumbIds: ids }))) return;
  selection.clear();
  await actions.remove(ids);
}

/* ---------- gallery: clicks, keyboard, drag ---------- */

galleryEl.addEventListener("click", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest(".videos")) return; // video strips: see video-controls.js
  const handle = target?.closest('[data-role="handle"]');
  if (handle) return select(idOf(handle), e.shiftKey);
  const button = target?.closest("button[data-action]");
  if (!(button instanceof HTMLButtonElement)) return;
  const { action, project = "" } = button.dataset;
  if (action === "upload-here") return uploads.chooseProject(project);
  if (action === "select-all") return selection.setMany(idsIn(project), button.dataset.mode !== "deselect");
  const id = idOf(button);
  if (action === "earlier") actions.step(id, (order) => moveBy(order, id, -1));
  else if (action === "later") actions.step(id, (order) => moveBy(order, id, 1));
  else if (action === "cover") actions.step(id, (order) => moveTo(order, id, 0));
  else if (action === "move") moveWithDialog([id]);
  else if (action === "delete") deleteWithConfirm([id]);
});

/** With a photo focused: arrows move it one place, Home/End to first/last. */
const KEY_MOVES = /** @type {Record<string, (order: number[], id: number) => number[]>} */ ({
  ArrowLeft: (order, id) => moveBy(order, id, -1),
  ArrowUp: (order, id) => moveBy(order, id, -1),
  ArrowRight: (order, id) => moveBy(order, id, 1),
  ArrowDown: (order, id) => moveBy(order, id, 1),
  Home: (order, id) => moveTo(order, id, 0),
  End: (order, id) => moveTo(order, id, order.length),
});
galleryEl.addEventListener("keydown", (e) => {
  const handle = e.target instanceof Element ? e.target.closest('[data-role="handle"]') : null;
  if (!handle) return;
  const id = idOf(handle);
  if (e.key === " ") {
    e.preventDefault(); // handled here (with Shift support) instead of the button's own click
    return select(id, e.shiftKey);
  }
  const reorder = KEY_MOVES[e.key];
  if (!reorder) return;
  e.preventDefault();
  actions.step(id, (order) => reorder(order, id));
});

setupSortable(galleryEl, {
  // Dragging a selected photo takes the whole selection along.
  dragIds: (id) => (selection.has(id) ? selection.inOrder(displayOrder()) : [id]),
  onDrop: ({ ids, project, beforeId }) => {
    selection.clear();
    actions.move(ids, project, beforeId);
  },
  onCancel: () => announce("Drag cancelled. Nothing changed."),
});

/* ---------- selection bars, Esc ---------- */

galleryBar.addEventListener("click", (e) => {
  const kind =
    e.target instanceof Element ? e.target.closest("[data-bulk]")?.getAttribute("data-bulk") : null;
  const ids = selection.inOrder(displayOrder());
  if (kind === "move") moveWithDialog(ids);
  else if (kind === "delete") deleteWithConfirm(ids);
  else if (kind === "clear") selection.clear();
});
trashBar.addEventListener("click", (e) => {
  const kind =
    e.target instanceof Element ? e.target.closest("[data-bulk]")?.getAttribute("data-bulk") : null;
  const ids = trashSelection.inOrder((state?.trash ?? []).map((t) => t.id));
  if (kind === "restore" && ids.length) {
    trashSelection.clear();
    actions.restore(ids);
  } else if (kind === "clear") trashSelection.clear();
});

window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
  (view === "gallery" ? selection : trashSelection).clear();
});

/* ---------- trash & views ---------- */

trashEl.addEventListener("click", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const handle = target?.closest('[data-role="handle"]');
  const trashOrder = (state?.trash ?? []).map((t) => t.id);
  if (handle) {
    const id = idOf(handle);
    return e.shiftKey ? trashSelection.extendTo(trashOrder, id) : trashSelection.toggle(id);
  }
  const videoButton = target?.closest('button[data-action="restore-video"]');
  if (videoButton) {
    videoControls.restore([Number(videoButton.getAttribute("data-video-id"))]);
    return;
  }
  const button = target?.closest('button[data-action="restore"]');
  if (!button) return;
  const id = idOf(button);
  trashSelection.prune(trashOrder.filter((x) => x !== id));
  actions.restore([id]).then(() => {
    const next = trashEl.querySelector('button[data-action="restore"]');
    if (next instanceof HTMLElement) next.focus();
    else byId("main").focus();
  });
});
trashEl.addEventListener("keydown", (e) => {
  const handle = e.target instanceof Element ? e.target.closest('[data-role="handle"]') : null;
  if (!handle || e.key !== " ") return;
  e.preventDefault();
  const id = idOf(handle);
  if (e.shiftKey)
    trashSelection.extendTo(
      (state?.trash ?? []).map((t) => t.id),
      id,
    );
  else trashSelection.toggle(id);
});

for (const tab of document.querySelectorAll(".view-tab")) {
  tab.addEventListener("click", () => {
    view = tab.getAttribute("data-view") === "trash" ? "trash" : "gallery";
    for (const t of document.querySelectorAll(".view-tab")) t.setAttribute("aria-pressed", String(t === tab));
    byId("gallery-view").hidden = view !== "gallery";
    byId("trash-view").hidden = view !== "trash";
    window.scrollTo({ top: 0 });
    syncSelections();
  });
}

// A photo file dropped anywhere but the upload box would make the browser open it and leave the admin.
for (const type of ["dragover", "drop"]) {
  window.addEventListener(type, (e) => {
    if (/** @type {DragEvent} */ (e).dataTransfer?.types.includes("Files")) e.preventDefault();
  });
}
window.addEventListener("beforeunload", (e) => {
  if (uploads.isBusy() || videoControls.isBusy()) e.preventDefault();
});

load();
