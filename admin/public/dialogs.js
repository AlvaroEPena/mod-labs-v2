// @ts-check
/**
 * The two confirmation dialogs (delete, move), for one photo or many. Native <dialog> handles
 * focus trapping and Esc.
 * @typedef {import("../lib/types.ts").AdminState} AdminState
 */
import { thumbUrl } from "./api.js";
import { h, plural } from "./dom.js";
import { fillProjectSelect } from "./render.js";

const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const MAX_THUMBS = 5;

for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (e) => {
    const button = e.target instanceof Element ? e.target.closest("[data-close]") : null;
    if (button) dialog.close(button.getAttribute("data-close") ?? "");
  });
}

/**
 * @param {HTMLDialogElement} dialog
 * @returns {Promise<boolean>} true when the confirm button was used
 */
function ask(dialog) {
  return new Promise((resolve) => {
    dialog.returnValue = "";
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
    dialog.showModal();
  });
}

/**
 * A row of up to five thumbnails, then "+N".
 * @param {HTMLElement} container
 * @param {readonly number[]} ids
 */
function showThumbs(container, ids) {
  const extra = ids.length - MAX_THUMBS;
  container.replaceChildren(
    ...ids.slice(0, MAX_THUMBS).map((id) => h("img", { src: thumbUrl(id), alt: "" })),
  );
  if (extra > 0) container.append(h("span", { class: "more" }, `+${extra}`));
  container.classList.toggle("is-single", ids.length === 1);
}

/**
 * @param {readonly number[]} ids
 * @returns {Promise<boolean>}
 */
export function confirmDelete(ids) {
  const isOne = ids.length === 1;
  showThumbs(byId("confirm-thumbs"), ids);
  byId("confirm-title").textContent = isOne ? "Delete this photo?" : `Delete ${plural(ids.length, "photo")}?`;
  byId("confirm-text").textContent = isOne
    ? "It goes to the Trash, and you can restore it from there."
    : "They go to the Trash, and you can restore them from there (or press Undo right after).";
  const confirm = byId("confirm-dialog").querySelector('[data-close="confirm"]');
  if (confirm) confirm.textContent = isOne ? "Move to trash" : `Move ${ids.length} to trash`;
  return ask(/** @type {HTMLDialogElement} */ (byId("confirm-dialog")));
}

/**
 * Ask where to move photos. Resolves to the chosen project, or null if cancelled or unchanged.
 * @param {AdminState} state
 * @param {readonly number[]} ids
 * @returns {Promise<string | null>}
 */
export async function chooseProject(state, ids) {
  const from = new Set(state.photos.filter((p) => ids.includes(p.id)).map((p) => p.project));
  const select = /** @type {HTMLSelectElement} */ (byId("move-project"));
  fillProjectSelect(select, state, { selected: from.size === 1 ? [...from][0] : state.projects[0].slug });
  showThumbs(byId("move-thumbs"), ids);
  byId("move-title").textContent = ids.length === 1 ? "Move photo" : `Move ${plural(ids.length, "photo")}`;

  const dialog = /** @type {HTMLDialogElement} */ (byId("move-dialog"));
  const confirm = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-close="confirm"]'));
  // Nothing to do if every photo is already in the chosen project.
  const isNoChange = () => from.size === 1 && from.has(select.value);
  select.onchange = () => (confirm.disabled = isNoChange());
  confirm.disabled = isNoChange();
  const answer = ask(dialog);
  select.focus();
  return (await answer) && !isNoChange() ? select.value : null;
}
