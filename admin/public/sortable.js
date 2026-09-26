// @ts-check
/**
 * Drag to reorder with Pointer Events (mouse, touch and pen), from anywhere on a card.
 * - Mouse/pen: a drag starts after the pointer moves a few pixels, so clicks and buttons still work.
 * - Touch: press and hold briefly, then drag; a quick swipe still scrolls the page.
 * - While dragging: a floating ghost follows the pointer, a placeholder gap shows where the photos
 *   will land (in any project), other cards slide out of the way (FLIP), the page scrolls near the
 *   top/bottom edge, and Esc cancels.
 * The DOM is only rearranged temporarily; on drop, `onDrop` gets the result and the app saves it.
 *
 * Markup contract: lists (`options.list`, default `.grid`) with `data-project`, holding items
 * (`options.item`, default `.card`) with `data-id`. Photos and videos each get their own sortable.
 */

const MOUSE_THRESHOLD_PX = 6;
const TOUCH_HOLD_MS = 280;
const TOUCH_SLOP_PX = 10;
const EDGE_PX = 90;
const MAX_SCROLL_PX_PER_FRAME = 22;
const FLIP_MS = 180;

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Animate elements from where they were to where `mutate` puts them.
 * @param {HTMLElement[]} elements
 * @param {() => void} mutate
 */
function flip(elements, mutate) {
  if (prefersReducedMotion()) return mutate();
  const before = new Map(elements.map((el) => [el, el.getBoundingClientRect()]));
  mutate();
  for (const [el, was] of before) {
    const now = el.getBoundingClientRect();
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (!dx && !dy) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
      duration: FLIP_MS,
      easing: "cubic-bezier(0.2, 0.9, 0.1, 1)",
    });
  }
}

/**
 * @typedef {{ ids: number[], project: string, beforeId: number | null }} DropResult
 * @typedef {{
 *   dragIds: (id: number) => number[],
 *   onDrop: (result: DropResult) => void,
 *   onCancel?: () => void,
 *   item?: string,
 *   list?: string,
 * }} SortableOptions
 */

/**
 * @param {HTMLElement} root container of the project grids
 * @param {SortableOptions} options
 */
export function setupSortable(root, { dragIds, onDrop, onCancel, item = ".card", list = ".grid" }) {
  /** @param {EventTarget | null} target */
  const cardOf = (target) =>
    target instanceof Element ? /** @type {HTMLElement | null} */ (target.closest(`${item}[data-id]`)) : null;

  /** @type {{ card: HTMLElement, pointerId: number, type: string, x: number, y: number, timer: number } | null} */
  let pending = null;
  /** @type {{ ids: number[], sources: HTMLElement[], ghost: HTMLElement, placeholder: HTMLElement, offsetX: number, offsetY: number, x: number, y: number, frame: number } | null} */
  let drag = null;

  const visibleCards = (/** @type {Element} */ grid) =>
    /** @type {HTMLElement[]} */ ([...grid.querySelectorAll(`:scope > ${item}:not(.is-drag-source)`)]);

  function start() {
    if (!pending) return;
    const { card, x, y } = pending;
    clearTimeout(pending.timer);
    pending = null;
    const ids = dragIds(Number(card.dataset.id));
    const sources = ids
      .map((id) => root.querySelector(`${item}[data-id="${id}"]`))
      .filter((el) => el instanceof HTMLElement);
    const rect = card.getBoundingClientRect();

    const ghost = /** @type {HTMLElement} */ (card.cloneNode(true));
    ghost.classList.remove("is-flash");
    ghost.classList.add("drag-ghost");
    ghost.removeAttribute("data-id");
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.width = `${rect.width}px`;
    if (ids.length > 1) {
      const badge = document.createElement("span");
      badge.className = "ghost-count";
      badge.textContent = String(ids.length);
      ghost.append(badge);
    }
    document.body.append(ghost);

    const placeholder = document.createElement("li");
    placeholder.className = "drop-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.style.height = `${rect.height}px`;

    drag = {
      ids,
      sources,
      ghost,
      placeholder,
      offsetX: x - rect.left,
      offsetY: y - rect.top,
      x,
      y,
      frame: 0,
    };
    const grids = [...new Set(sources.map((s) => /** @type {Element} */ (s.parentElement)))];
    flip(grids.flatMap(visibleCards), () => {
      card.before(placeholder);
      for (const s of sources) s.classList.add("is-drag-source");
    });
    document.body.classList.add("is-sorting");
    moveGhost();
    drag.frame = requestAnimationFrame(autoScroll);
  }

  function moveGhost() {
    if (!drag) return;
    drag.ghost.style.transform = `translate(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px)`;
  }

  /** Move the placeholder to where the pointer is, if that's a different spot. */
  function relocate() {
    if (!drag) return;
    const hit = document.elementFromPoint(drag.x, drag.y);
    const grid =
      hit?.closest(`${list}[data-project]`) ??
      hit?.closest(".project")?.querySelector(`${list}[data-project]`);
    if (!(grid instanceof HTMLElement)) return;

    const { x, y, placeholder } = drag;
    const before =
      visibleCards(grid).find((card) => {
        const r = card.getBoundingClientRect();
        return y < r.top || (y <= r.bottom && x < r.left + r.width / 2);
      }) ?? null;
    const isSameSpot = placeholder.parentElement === grid && nextCard(placeholder) === before;
    if (isSameSpot) return;
    const oldGrid = placeholder.parentElement;
    const affected = [...new Set([oldGrid, grid])].flatMap((g) => (g ? visibleCards(g) : []));
    flip(affected, () => {
      if (before) before.before(placeholder);
      else grid.append(placeholder);
    });
  }

  /** @param {Element} el */
  function nextCard(el) {
    let next = el.nextElementSibling;
    while (next && !(next.matches(item) && !next.classList.contains("is-drag-source")))
      next = next.nextElementSibling;
    return next;
  }

  /** Scroll while the pointer is near the top or bottom edge; keep the drop spot under it. */
  function autoScroll() {
    if (!drag) return;
    const { y } = drag;
    const top = EDGE_PX - y;
    const bottom = y - (window.innerHeight - EDGE_PX);
    const speed = top > 0 ? -Math.min(1, top / EDGE_PX) : bottom > 0 ? Math.min(1, bottom / EDGE_PX) : 0;
    if (speed) {
      window.scrollBy(0, Math.round(speed * MAX_SCROLL_PX_PER_FRAME));
      relocate();
    }
    drag.frame = requestAnimationFrame(autoScroll);
  }

  /** @param {boolean} commit */
  function finish(commit) {
    if (!drag) return;
    const { ids, sources, ghost, placeholder, frame } = drag;
    drag = null;
    cancelAnimationFrame(frame);
    const grid = placeholder.parentElement;
    const result =
      commit && grid instanceof HTMLElement && grid.dataset.project
        ? {
            ids,
            project: grid.dataset.project,
            beforeId: Number(nextCard(placeholder)?.getAttribute("data-id")) || null,
          }
        : null;
    const grids = [...new Set([grid, ...sources.map((s) => s.parentElement)])];
    flip(
      grids.flatMap((g) => (g ? visibleCards(g) : [])),
      () => {
        // Committed: the cards land in the gap (the app then re-renders the same order).
        if (result) placeholder.replaceWith(...sources);
        else placeholder.remove();
        for (const s of sources) s.classList.remove("is-drag-source");
      },
    );
    ghost.remove();
    document.body.classList.remove("is-sorting");
    // The pointerup that ends a drag is followed by a click; it must not toggle a selection.
    const swallow = (/** @type {Event} */ e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    if (result) onDrop(result);
    else onCancel?.();
  }

  root.addEventListener("pointerdown", (e) => {
    if (drag || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    const card = cardOf(e.target);
    if (!card || !root.contains(card)) return;
    pending = { card, pointerId: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, timer: 0 };
    if (e.pointerType === "touch") pending.timer = window.setTimeout(start, TOUCH_HOLD_MS);
  });

  window.addEventListener("pointermove", (e) => {
    if (drag) {
      drag.x = e.clientX;
      drag.y = e.clientY;
      moveGhost();
      relocate();
      return;
    }
    if (!pending || e.pointerId !== pending.pointerId) return;
    const distance = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
    if (pending.type === "touch") {
      if (distance > TOUCH_SLOP_PX) {
        clearTimeout(pending.timer); // moved before the hold finished: it's a scroll
        pending = null;
      }
    } else if (distance > MOUSE_THRESHOLD_PX) {
      pending.x = e.clientX;
      pending.y = e.clientY;
      start();
    }
  });

  const endPointer = (/** @type {boolean} */ commit) => () => {
    if (pending) clearTimeout(pending.timer);
    pending = null;
    finish(commit);
  };
  window.addEventListener("pointerup", endPointer(true));
  window.addEventListener("pointercancel", endPointer(false));

  // Touch: once a drag has started, stop the page from scrolling under the finger.
  window.addEventListener(
    "touchmove",
    (e) => {
      if (drag) e.preventDefault();
    },
    { passive: false },
  );
  root.addEventListener("contextmenu", (e) => {
    if (drag || pending?.type === "touch") e.preventDefault(); // long-press menu
  });
  root.addEventListener("dragstart", (e) => e.preventDefault()); // no native image dragging

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !drag) return;
      e.stopPropagation(); // Esc cancels the drag only; it doesn't also clear the selection
      finish(false);
    },
    { capture: true },
  );

  return { isDragging: () => drag !== null };
}
