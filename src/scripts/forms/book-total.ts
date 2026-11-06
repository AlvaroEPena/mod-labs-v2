/**
 * /book: live readout under the mod tiles ("2 mods selected, $280 estimated"), so the price is clear before
 * sending. Prices come from each checkbox's data-price (rendered from services.ts). Prices are confirmed
 * with the customer later, so the copy says "estimated".
 */
import { totalText } from "./book-total-text";

const form = document.querySelector<HTMLFormElement>('form[data-lab-form="book"]');
const out = form?.querySelector<HTMLElement>("[data-book-total]");

if (form && out) {
  const boxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-price]'));
  const update = () => (out.textContent = totalText(boxes.filter((b) => b.checked).map((b) => Number(b.dataset.price) || 0)));
  form.addEventListener("change", update);
  form.addEventListener("reset", () => requestAnimationFrame(update));
  update(); // reflects ?service= prefill and back/forward restores
}
