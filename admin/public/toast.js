// @ts-check
/**
 * Short status messages in the page's aria-live region, optionally with one action (Undo).
 * A new message replaces the previous one.
 */
import { h } from "./dom.js";

const region = /** @type {HTMLElement} */ (document.getElementById("status"));
let timer = 0;

/**
 * @param {string} message
 * @param {{ isError?: boolean, action?: { label: string, run: () => void } }} [options]
 */
export function announce(message, { isError = false, action } = {}) {
  clearTimeout(timer);
  const button = action && h("button", { type: "button", class: "btn small" }, action.label);
  button?.addEventListener("click", () => {
    region.replaceChildren();
    action?.run();
  });
  region.replaceChildren(
    h("div", { class: `toast${isError ? " is-error" : ""}` }, h("p", {}, message), button),
  );
  timer = window.setTimeout(() => region.replaceChildren(), action || isError ? 12000 : 5000);
}
