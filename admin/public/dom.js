// @ts-check
/**
 * Tiny DOM helpers shared by the renderers. Text always goes through textContent/attributes
 * (never innerHTML), except the constant SVG icons below.
 * @typedef {Node | string | null | undefined | false} Child
 */
import { thumbUrl } from "./api.js";

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string | number | boolean | undefined>} [attrs] booleans toggle the attribute
 * @param {...Child} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === undefined) continue;
    el.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

const ICONS = {
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  move: '<path d="M4 7h11M11 3l4 4-4 4M20 17H9M13 13l-4 4 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="3" stroke-linecap="round"/>',
};

/** @param {keyof typeof ICONS} name */
export function icon(name) {
  const span = h("span", { "aria-hidden": "true" });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

/**
 * @param {string} label
 * @param {keyof typeof ICONS} iconName
 * @param {Record<string, string | number | boolean | undefined>} attrs
 */
export const iconButton = (label, iconName, attrs) =>
  h(
    "button",
    { type: "button", class: "icon-btn", "aria-label": label, title: label, ...attrs },
    icon(iconName),
  );

/**
 * The photo itself is the card's handle: click or Space selects it, arrow keys move it, and
 * dragging from anywhere on the card reorders. `aria-pressed` carries the selected state.
 * @param {number} id
 * @param {string} label
 */
export const photoHandle = (id, label) =>
  h(
    "button",
    {
      type: "button",
      class: "thumb",
      "data-role": "handle",
      "aria-pressed": "false",
      "aria-label": label,
      "aria-describedby": "card-help",
    },
    h("img", { src: thumbUrl(id), alt: "", loading: "lazy", decoding: "async", draggable: "false" }),
    h("span", { class: "check" }, icon("check")),
  );

export const plural = (/** @type {number} */ n, /** @type {string} */ word) =>
  `${n} ${word}${n === 1 ? "" : "s"}`;
