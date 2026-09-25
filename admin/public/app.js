// @ts-check
/**
 * Photo admin UI controller: loads state, wires every action (reorder, move, delete/undo,
 * restore, upload) and keeps focus and screen-reader announcements sensible after each change.
 * @typedef {import("../lib/types.ts").AdminState} AdminState
 * @typedef {{ id: number, action: string }} FocusTarget
 */
import { ApiRequestError, getState, post, thumbUrl } from "./api.js";
import { moveBy, moveTo, placeNextTo, sameOrder } from "./order.js";
import { fillProjectSelect, h, projectTitles, renderBanner, renderGallery, renderTrash } from "./render.js";
import { setupDragAndDrop } from "./dnd.js";
import { setupUpload } from "./upload.js";

const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const galleryEl = byId("gallery");
const trashEl = byId("trash");
const statusEl = byId("status");

/** @type {AdminState | undefined} */
let state;
let isBusy = false;

/* ---------- announcements ---------- */

let toastTimer = 0;
/**
 * Show (and announce) a short message, optionally with one action button such as Undo.
 * @param {string} message
 * @param {boolean} [isError]
 * @param {{ label: string, run: () => void }} [action]
 */
function announce(message, isError = false, action) {
  clearTimeout(toastTimer);
  const button = action && h("button", { type: "button", class: "btn small" }, action.label);
  button?.addEventListener("click", () => {
    statusEl.replaceChildren();
    action?.run();
  });
  statusEl.replaceChildren(
    h("div", { class: `toast${isError ? " is-error" : ""}` }, h("p", {}, message), button),
  );
  toastTimer = window.setTimeout(() => statusEl.replaceChildren(), action || isError ? 12000 : 5000);
}

/* ---------- state & rendering ---------- */

const uploads = setupUpload({
  getState: () => state,
  onUploaded: (next, id) => applyState(next, { id, action: "grip" }, false),
  announce,
});

/**
 * @param {AdminState} next
 * @param {FocusTarget} [focus] control to focus afterwards (falls back to the card's grip)
 * @param {boolean} [moveFocus] false = only highlight the card (e.g. while uploading)
 */
function applyState(next, focus, moveFocus = true) {
  state = next;
  renderGallery(galleryEl, byId("jump"), next);
  renderTrash(trashEl, next);
  renderBanner(byId("banner"), next.pending);
  byId("trash-count").textContent = String(next.trash.length);
  fillProjectSelect(/** @type {HTMLSelectElement} */ (byId("upload-project")), next, {
    placeholder: "Choose a project…",
  });
  if (!focus) return;
  const card = document.querySelector(`.card[data-id="${focus.id}"]`);
  if (!(card instanceof HTMLElement)) return;
  card.classList.add("is-flash");
  if (!moveFocus) return;
  const wanted = card.querySelector(`[data-action="${focus.action}"]`);
  const target =
    wanted instanceof HTMLButtonElement && !wanted.disabled
      ? wanted
      : card.querySelector('[data-action="grip"]');
  if (target instanceof HTMLElement) target.focus();
  card.scrollIntoView({ block: "nearest" });
}

/**
 * Run one change against the server, then re-render. One change at a time.
 * @param {() => Promise<AdminState>} task
 * @param {string} message
 * @param {FocusTarget} [focus]
 * @param {{ label: string, run: () => void }} [action]
 */
async function change(task, message, focus, action) {
  if (isBusy) return;
  isBusy = true;
  try {
    applyState(await task(), focus);
    announce(message, false, action);
  } catch (err) {
    announce(err instanceof Error ? err.message : "That didn't work.", true);
    // stale page (another tab, a restart): reload so what's shown matches the disk again
    if (err instanceof ApiRequestError && [404, 409].includes(err.status)) await load();
  } finally {
    isBusy = false;
  }
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

/* ---------- helpers ---------- */

const photoOf = (/** @type {number} */ id) => state?.photos.find((p) => p.id === id);
const idsIn = (/** @type {string} */ project) =>
  (state?.photos ?? []).filter((p) => p.project === project).map((p) => p.id);
const titleOf = (/** @type {string} */ project) =>
  (state ? projectTitles(state).get(project) : undefined) ?? project;

/**
 * @param {number} id
 * @param {(ids: number[]) => number[]} reorderFn
 * @param {string} focusAction
 */
function reorder(id, reorderFn, focusAction) {
  const photo = photoOf(id);
  if (!photo) return;
  const before = idsIn(photo.project);
  const after = reorderFn(before);
  if (sameOrder(before, after)) return;
  const position = after.indexOf(id) + 1;
  const message =
    position === 1
      ? `Photo is now the cover of ${titleOf(photo.project)}.`
      : `Moved to position ${position} of ${after.length}.`;
  change(() => post("reorder", { project: photo.project, ids: after }), message, { id, action: focusAction });
}

/**
 * Open a confirm-style dialog; resolves true when the confirm button was used.
 * @param {HTMLDialogElement} dialog
 * @returns {Promise<boolean>}
 */
function ask(dialog) {
  return new Promise((resolve) => {
    dialog.returnValue = "";
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
    dialog.showModal();
  });
}
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (e) => {
    const button = e.target instanceof Element ? e.target.closest("[data-close]") : null;
    if (button) dialog.close(button.getAttribute("data-close") ?? "");
  });
}

/** @param {number} id */
async function deletePhoto(id) {
  const photo = photoOf(id);
  if (!photo) return;
  /** @type {HTMLImageElement} */ (byId("confirm-thumb")).src = thumbUrl(id);
  if (!(await ask(/** @type {HTMLDialogElement} */ (byId("confirm-dialog"))))) return;
  const siblings = idsIn(photo.project);
  const neighbour = siblings[siblings.indexOf(id) + 1] ?? siblings[siblings.indexOf(id) - 1];
  await change(
    () => post("delete", { id }),
    `Photo moved to the trash from ${titleOf(photo.project)}.`,
    neighbour ? { id: neighbour, action: "delete" } : undefined,
    {
      label: "Undo",
      run: () => change(() => post("restore", { id }), "Photo restored.", { id, action: "delete" }),
    },
  );
}

/** @param {number} id */
async function movePhoto(id) {
  const photo = photoOf(id);
  if (!photo || !state) return;
  const select = /** @type {HTMLSelectElement} */ (byId("move-project"));
  fillProjectSelect(select, state, { selected: photo.project });
  /** @type {HTMLImageElement} */ (byId("move-thumb")).src = thumbUrl(id);
  const dialog = /** @type {HTMLDialogElement} */ (byId("move-dialog"));
  // Only allow confirming once a different project is chosen.
  const confirmButton = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-close="confirm"]'));
  const syncConfirm = () => (confirmButton.disabled = select.value === photo.project);
  select.onchange = syncConfirm;
  syncConfirm();
  const confirmed = ask(dialog);
  select.focus();
  if (!(await confirmed) || select.value === photo.project) return;
  const project = select.value;
  await change(() => post("move", { id, project }), `Photo moved to ${titleOf(project)} (at the end).`, {
    id,
    action: "move",
  });
}

/* ---------- gallery events ---------- */

galleryEl.addEventListener("click", (e) => {
  const button = e.target instanceof Element ? e.target.closest("button[data-action]") : null;
  if (!(button instanceof HTMLButtonElement)) return;
  const action = button.dataset.action;
  if (action === "upload-here") return uploads.chooseProject(button.dataset.project ?? "");
  const id = Number(button.closest(".card")?.getAttribute("data-id"));
  if (!id) return;
  if (action === "earlier") reorder(id, (ids) => moveBy(ids, id, -1), "earlier");
  else if (action === "later") reorder(id, (ids) => moveBy(ids, id, 1), "later");
  else if (action === "cover") reorder(id, (ids) => moveTo(ids, id, 0), "grip");
  else if (action === "move") movePhoto(id);
  else if (action === "delete") deletePhoto(id);
});

/** Keyboard reordering on the grip button: arrows move one place, Home/End jump to first/last. */
const KEY_MOVES = /** @type {Record<string, (ids: number[], id: number) => number[]>} */ ({
  ArrowLeft: (ids, id) => moveBy(ids, id, -1),
  ArrowUp: (ids, id) => moveBy(ids, id, -1),
  ArrowRight: (ids, id) => moveBy(ids, id, 1),
  ArrowDown: (ids, id) => moveBy(ids, id, 1),
  Home: (ids, id) => moveTo(ids, id, 0),
  End: (ids, id) => moveTo(ids, id, ids.length),
});
galleryEl.addEventListener("keydown", (e) => {
  const grip = e.target instanceof Element ? e.target.closest('[data-action="grip"]') : null;
  const move = KEY_MOVES[e.key];
  if (!grip || !move) return;
  e.preventDefault();
  const id = Number(grip.closest(".card")?.getAttribute("data-id"));
  reorder(id, (ids) => move(ids, id), "grip");
});

/* ---------- drag and drop (within a project) ---------- */

setupDragAndDrop(galleryEl, (id, targetId, after) =>
  reorder(id, (ids) => placeNextTo(ids, id, targetId, after), "grip"),
);

// A photo file dropped anywhere but the upload box would make the browser open it and leave the admin.
for (const type of ["dragover", "drop"]) {
  window.addEventListener(type, (e) => {
    if (/** @type {DragEvent} */ (e).dataTransfer?.types.includes("Files")) e.preventDefault();
  });
}
window.addEventListener("beforeunload", (e) => {
  if (uploads.isBusy()) e.preventDefault();
});

/* ---------- trash & views ---------- */

trashEl.addEventListener("click", (e) => {
  const button = e.target instanceof Element ? e.target.closest('button[data-action="restore"]') : null;
  const id = Number(button?.closest(".card")?.getAttribute("data-id"));
  const item = state?.trash.find((t) => t.id === id);
  if (!item) return;
  change(() => post("restore", { id }), `Photo restored to ${titleOf(item.project)}.`).then(() => {
    const next = trashEl.querySelector('button[data-action="restore"]');
    if (next instanceof HTMLElement) next.focus();
    else byId("main").focus();
  });
});

for (const tab of document.querySelectorAll(".view-tab")) {
  tab.addEventListener("click", () => {
    const view = tab.getAttribute("data-view");
    for (const t of document.querySelectorAll(".view-tab")) t.setAttribute("aria-pressed", String(t === tab));
    byId("gallery-view").hidden = view !== "gallery";
    byId("trash-view").hidden = view !== "trash";
  });
}

load();
