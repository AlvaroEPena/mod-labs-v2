/**
 * Live readout beside the star picker ("4 out of 5: Great"). The picker itself is native radios, so
 * keyboard (arrows), form reset and screen readers need no script; this only keeps the visible text in
 * sync. The readout is aria-hidden: each radio's own name already says the same thing.
 */
import { ratingText } from "./rating";

for (const root of document.querySelectorAll<HTMLElement>("[data-star-rating]")) {
  const out = root.querySelector<HTMLElement>("[data-star-text]");
  const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  if (!out || !radios.length) continue;
  const update = () => (out.textContent = ratingText(Number(radios.find((r) => r.checked)?.value ?? 0)));
  root.addEventListener("change", update);
  root.closest("form")?.addEventListener("reset", () => requestAnimationFrame(update));
  update();
}
