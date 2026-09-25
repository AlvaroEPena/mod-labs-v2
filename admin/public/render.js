// @ts-check
/**
 * Builds the gallery view and the publishing banner from an AdminState.
 * @typedef {import("../lib/types.ts").AdminState} AdminState
 * @typedef {import("../lib/types.ts").AdminPhoto} AdminPhoto
 * @typedef {import("../lib/types.ts").PendingChanges} PendingChanges
 */
import { h, icon, iconButton, photoHandle, plural } from "./dom.js";

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
  const preview = h(
    "a",
    { href: "http://localhost:4321/gallery", target: "_blank", rel: "noopener" },
    "localhost:4321/gallery",
  );
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
      preview,
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
  const where = `photo ${index + 1} of ${total} in ${title}`;
  return h(
    "li",
    { class: "card", "data-id": photo.id, "data-project": photo.project },
    photoHandle(photo.id, `${where[0].toUpperCase()}${where.slice(1)}`),
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
      iconButton("Move earlier", "left", { "data-action": "earlier", disabled: isFirst }),
      iconButton("Move later", "right", { "data-action": "later", disabled: index === total - 1 }),
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
            photos.length > 0 &&
              h(
                "button",
                {
                  type: "button",
                  class: "link-btn",
                  "data-action": "select-all",
                  "data-project": project.slug,
                },
                "Select all",
              ),
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
          // Always a list, so an empty project is still a drop target.
          h(
            "ol",
            { class: "grid", "data-project": project.slug, "aria-labelledby": headingId },
            ...photos.map((p, i) => photoCard(p, i, photos.length, project.title)),
            photos.length === 0 &&
              h(
                "li",
                { class: "empty-slot" },
                "No photos yet: drag photos here or use Add photos. Hidden on the site until it has one.",
              ),
          ),
        );
      }),
    );
  });
  container.replaceChildren(...sections);
  container.setAttribute("aria-busy", "false");
  jumpNav.replaceChildren(...state.categories.map((c) => h("a", { href: `#cat-${c.slug}` }, c.title)));
}
