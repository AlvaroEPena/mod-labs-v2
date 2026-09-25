// @ts-check
/**
 * The Trash view: deleted photos, newest first, each selectable (for "Restore N") and with its
 * own Restore button.
 * @typedef {import("../lib/types.ts").AdminState} AdminState
 */
import { h, photoHandle } from "./dom.js";
import { projectTitles } from "./render.js";

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
          photoHandle(t.id, `Deleted photo from ${title}`),
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
