// @ts-check
/**
 * Drag-and-drop reordering inside one project's grid. Dropping on another project is ignored on
 * purpose: moving between projects goes through the "Move" dialog, which says where it lands.
 */

/**
 * @param {HTMLElement} root the gallery container
 * @param {(id: number, targetId: number, after: boolean) => void} onDrop
 */
export function setupDragAndDrop(root, onDrop) {
  /** @type {{ id: number, project: string } | undefined} */
  let dragged;

  const clearMarks = (/** @type {string[]} */ ...classes) =>
    root
      .querySelectorAll(classes.map((c) => `.${c}`).join(","))
      .forEach((el) => el.classList.remove(...classes));

  /** The card under the pointer, if it's in the same project as the dragged one. @param {DragEvent} e */
  function targetOf(e) {
    const card = e.target instanceof Element ? e.target.closest(".card") : null;
    if (!(card instanceof HTMLElement) || !dragged || card.dataset.project !== dragged.project)
      return undefined;
    const rect = card.getBoundingClientRect();
    return { card, id: Number(card.dataset.id), after: e.clientX > rect.left + rect.width / 2 };
  }

  root.addEventListener("dragstart", (e) => {
    const card = e.target instanceof Element ? e.target.closest(".card") : null;
    if (!(card instanceof HTMLElement) || !e.dataTransfer) return;
    dragged = { id: Number(card.dataset.id), project: card.dataset.project ?? "" };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(dragged.id));
    card.classList.add("is-dragging");
  });

  root.addEventListener("dragover", (e) => {
    const target = targetOf(e);
    if (!target) return;
    e.preventDefault(); // marks this card as a valid drop target
    clearMarks("drop-before", "drop-after");
    if (target.id !== dragged?.id) target.card.classList.add(target.after ? "drop-after" : "drop-before");
  });

  root.addEventListener("drop", (e) => {
    const target = targetOf(e);
    if (!target || !dragged) return;
    e.preventDefault();
    if (target.id !== dragged.id) onDrop(dragged.id, target.id, target.after);
  });

  root.addEventListener("dragend", () => {
    dragged = undefined;
    clearMarks("drop-before", "drop-after", "is-dragging");
  });
}
