// @ts-check
/**
 * Builds the admin DOM from an AdminState. Text always goes through textContent/attributes
 * (never innerHTML), except the constant SVG icons below.
 * @typedef {import("../lib/types.ts").AdminState} AdminState
 * @typedef {import("../lib/types.ts").AdminPhoto} AdminPhoto
 * @typedef {import("../lib/types.ts").PendingChanges} PendingChanges
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
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3.2" stroke-linecap="round"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  move: '<path d="M4 7h11M11 3l4 4-4 4M20 17H9M13 13l-4 4 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};

/** @param {keyof typeof ICONS} name */
function icon(name) {
  const span = h("span", { "aria-hidden": "true" });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

/**
 * @param {string} label
 * @param {keyof typeof ICONS} iconName
 * @param {Record<string, string | number | boolean | undefined>} attrs
 */
const iconButton = (label, iconName, attrs) =>
  h(
    "button",
    { type: "button", class: "icon-btn", "aria-label": label, title: label, ...attrs },
    icon(iconName),
  );

const plural = (/** @type {number} */ n, /** @type {string} */ word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** @param {AdminState} state */
export const projectTitles = (state) => new Map(state.projects.map((p) => [p.slug, p.title]));

/**
 * Fill a <select> with projects grouped by category.
 * @param {HTMLSelectElement} select
 * @param {AdminState} state
 * @param {{ selected?: string, placeholder?: string }} [options]
 */
export function fillProjectSelect(select, state, { selected = "", placeholder } = {}) {
  const keep = selected || select.value;
  select.replaceChildren();
  if (placeholder) select.append(h("option", { value: "" }, placeholder));
  for (const category of state.categories) {
    const group = h("optgroup", { label: category.title });
    for (const p of state.projects.filter((x) => x.category === category.slug)) {
      group.append(h("option", { value: p.slug }, p.title));
    }
    select.append(group);
  }
  select.value = keep;
}

/**
 * @param {HTMLElement} el
 * @param {PendingChanges} pending
 */
export function renderBanner(el, pending) {
  const count = pending.count;
  el.classList.toggle("has-changes", Boolean(count));
  const status =
    count === null
      ? h("p", {}, "Couldn't check for unpublished changes. ", h("span", { class: "hint" }, pending.reason))
      : count === 0
        ? h("p", {}, h("strong", {}, "No photo changes"), " since the last saved version (git commit).")
        : h("p", {}, h("strong", {}, `${plural(count, "gallery file")} changed`), " and not published yet.");
  el.replaceChildren(
    status,
    h(
      "p",
      { class: "hint" },
      "Publish with ",
      h("code", {}, "npm run deploy"),
      ". Preview first with ",
      h("code", {}, "npm run dev"),
      " → ",
      h(
        "a",
        { href: "http://localhost:4321/gallery", target: "_blank", rel: "noopener" },
        "localhost:4321/gallery",
      ),
      ".",
    ),
  );
}

/**
 * @param {AdminPhoto} photo
 * @param {number} index
 * @param {number} total
 * @param {string} title
 */
function photoCard(photo, index, total, title) {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const where = `photo ${index + 1} of ${total} in ${title}`;
  return h(
    "li",
    { class: "card", draggable: "true", "data-id": photo.id, "data-project": photo.project },
    h(
      "div",
      { class: "thumb" },
      h("img", {
        src: thumbUrl(photo.id),
        alt: `${where[0].toUpperCase()}${where.slice(1)}`,
        loading: "lazy",
        decoding: "async",
        draggable: "false",
      }),
    ),
    h(
      "div",
      { class: "card-meta" },
      h("span", { class: "pos" }, `#${index + 1}`),
      isFirst && h("span", { class: "badge" }, "Cover"),
      h("span", {}, `id ${photo.id}`),
    ),
    h(
      "div",
      { class: "card-actions" },
      iconButton(`Reorder ${where}. Use the arrow keys to move it.`, "grip", {
        class: "icon-btn grip",
        "data-action": "grip",
        "aria-describedby": "reorder-help",
      }),
      iconButton("Move earlier", "left", { "data-action": "earlier", disabled: isFirst }),
      iconButton("Move later", "right", { "data-action": "later", disabled: isLast }),
      iconButton("Make this the cover", "star", { "data-action": "cover", disabled: isFirst }),
    ),
    h(
      "div",
      { class: "card-actions secondary" },
      h(
        "button",
        {
          type: "button",
          class: "btn small",
          "data-action": "move",
          "aria-label": `Move ${where} to another project`,
        },
        icon("move"),
        "Move…",
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn small delete",
          "data-action": "delete",
          "aria-label": `Delete ${where}`,
        },
        icon("trash"),
        "Delete",
      ),
    ),
  );
}

/**
 * @param {HTMLElement} container
 * @param {HTMLElement} jumpNav
 * @param {AdminState} state
 */
export function renderGallery(container, jumpNav, state) {
  const sections = state.categories.map((category) => {
    const projects = state.projects.filter((p) => p.category === category.slug);
    const photoCount = state.photos.filter((p) => p.category === category.slug).length;
    return h(
      "section",
      { class: "category", id: `cat-${category.slug}`, "aria-labelledby": `cat-${category.slug}-title` },
      h(
        "h2",
        { id: `cat-${category.slug}-title` },
        category.title,
        h("span", { class: "count" }, plural(photoCount, "photo")),
      ),
      ...projects.map((project) => {
        const photos = state.photos.filter((p) => p.project === project.slug);
        const headingId = `proj-${project.slug}`;
        return h(
          "section",
          { class: "project", "aria-labelledby": headingId },
          h(
            "div",
            { class: "project-head" },
            h("h3", { id: headingId }, project.title),
            h("span", { class: "count" }, plural(photos.length, "photo")),
            h(
              "button",
              {
                type: "button",
                class: "link-btn",
                "data-action": "upload-here",
                "data-project": project.slug,
              },
              "Add photos here",
            ),
          ),
          photos.length
            ? h(
                "ol",
                { class: "grid", "data-project": project.slug, "aria-labelledby": headingId },
                ...photos.map((p, i) => photoCard(p, i, photos.length, project.title)),
              )
            : h(
                "p",
                { class: "empty" },
                "No photos yet. This project stays hidden on the site until it has one.",
              ),
        );
      }),
    );
  });
  container.replaceChildren(...sections);
  container.setAttribute("aria-busy", "false");
  jumpNav.replaceChildren(...state.categories.map((c) => h("a", { href: `#cat-${c.slug}` }, c.title)));
}

/**
 * @param {HTMLElement} container
 * @param {AdminState} state
 */
export function renderTrash(container, state) {
  if (!state.trash.length) {
    container.replaceChildren(h("p", { class: "empty" }, "The trash is empty."));
    return;
  }
  const titles = projectTitles(state);
  const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  container.replaceChildren(
    h(
      "ul",
      { class: "grid", "aria-label": "Deleted photos" },
      ...state.trash.map((t) => {
        const title = titles.get(t.project) ?? t.project;
        return h(
          "li",
          { class: "card", "data-id": t.id },
          h(
            "div",
            { class: "thumb" },
            h("img", { src: thumbUrl(t.id), alt: `Deleted photo from ${title}`, loading: "lazy" }),
          ),
          h(
            "div",
            { class: "trash-meta" },
            h("span", {}, "From ", h("strong", {}, title)),
            h(
              "span",
              {},
              "Deleted ",
              h("time", { datetime: t.deletedAt }, when.format(new Date(t.deletedAt))),
            ),
          ),
          h(
            "div",
            { class: "card-actions" },
            h(
              "button",
              {
                type: "button",
                class: "btn small",
                "data-action": "restore",
                "aria-label": `Restore this photo to ${title}`,
              },
              "Restore",
            ),
          ),
        );
      }),
    ),
  );
}
