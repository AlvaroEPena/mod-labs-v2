/**
 * Live FAQ filter for /faq. The search box ships hidden and is revealed here (no JS = no dead control).
 * Typing hides non-matching questions, reports the count in a polite live region and shows an empty
 * state with a way to ask directly. Esc clears. Matching rules live in faq-match.ts.
 */
import { matchesQuery, resultText } from "./faq-match";

const root = document.querySelector<HTMLElement>("[data-faq-search]");
const input = root?.querySelector<HTMLInputElement>("input[type=search]");
const count = root?.querySelector<HTMLElement>("[data-faq-count]");
const items = Array.from(document.querySelectorAll<HTMLDetailsElement>("[data-faq-list] details.faq-item"));
const empty = document.querySelector<HTMLElement>("[data-faq-empty]");
const emptyQuery = empty?.querySelector<HTMLElement>("[data-faq-query]");

if (root && input && items.length) {
  root.hidden = false;
  const texts = items.map((d) => d.textContent ?? "");

  const apply = () => {
    const q = input.value;
    const hasQuery = q.trim().length > 0;
    let shown = 0;
    items.forEach((d, i) => {
      const hit = matchesQuery(q, texts[i]);
      d.hidden = !hit;
      if (hit) shown++;
    });
    if (count) count.textContent = resultText(shown, items.length, hasQuery);
    if (empty) empty.hidden = shown > 0;
    if (emptyQuery) emptyQuery.textContent = q.trim();
  };

  input.addEventListener("input", apply);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && input.value) {
      input.value = "";
      apply();
    }
  });
  apply();
}
