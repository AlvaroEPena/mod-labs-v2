/**
 * Pointer spotlight for `.glow-edge` cards: writes the pointer position into --mx/--my so the card's
 * CSS light (global.css) follows it. One delegated, passive listener; fine pointers only, and off when
 * the visitor prefers reduced motion. No layout work besides one rect read per move on one element.
 */
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

if (finePointer.matches && !reducedMotion.matches) {
  document.addEventListener(
    "pointermove",
    (e) => {
      const card = (e.target as Element | null)?.closest?.<HTMLElement>(".glow-edge");
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    },
    { passive: true },
  );
}
