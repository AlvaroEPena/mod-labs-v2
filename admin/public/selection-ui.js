// @ts-check
/**
 * Mirrors a Selection onto the page: card highlight + aria-pressed, each project's
 * "Select all"/"Deselect all" button, and the sticky action bar ("N selected · … · Clear").
 * @typedef {import("./select.js").Selection} Selection
 */
import { plural } from "./dom.js";

/**
 * @param {HTMLElement} root the gallery or trash container
 * @param {Selection} selection
 * @param {HTMLElement} bar the sticky action bar for this view
 * @param {boolean} isActiveView only the visible view shows its bar
 */
export function syncSelection(root, selection, bar, isActiveView) {
  for (const card of root.querySelectorAll(".card[data-id]")) {
    const isSelected = selection.has(Number(card.getAttribute("data-id")));
    card.classList.toggle("is-selected", isSelected);
    card.querySelector('[data-role="handle"]')?.setAttribute("aria-pressed", String(isSelected));
  }
  for (const button of root.querySelectorAll('[data-action="select-all"]')) {
    const grid = root.querySelector(`.grid[data-project="${button.getAttribute("data-project")}"]`);
    const ids = [...(grid?.querySelectorAll(".card[data-id]") ?? [])].map((c) =>
      Number(c.getAttribute("data-id")),
    );
    const isAllSelected = ids.length > 0 && ids.every((id) => selection.has(id));
    button.textContent = isAllSelected ? "Deselect all" : "Select all";
    button.setAttribute("data-mode", isAllSelected ? "deselect" : "select");
  }
  const count = bar.querySelector("[data-count]");
  if (count) count.textContent = `${plural(selection.size, "photo")} selected`;
  bar.hidden = !isActiveView || selection.size === 0;
  document.body.classList.toggle("has-selection", !bar.hidden);
}
