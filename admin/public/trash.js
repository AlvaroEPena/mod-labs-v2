// @ts-check
/**
 * The Trash view: deleted photos (selectable for "Restore N", each with its own Restore button)
 * and deleted videos (each with Restore), newest first.
 * @typedef {import("../lib/types.ts").AdminState} AdminState
 */
import { thumbUrl } from "./api.js";
import { h, photoHandle } from "./dom.js";
import { projectTitles } from "./render.js";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * @param {string} title project title
 * @param {string} deletedAt
 */
const trashMeta = (title, deletedAt) =>
  h(
    "div",
    { class: "trash-meta" },
    h("span", {}, "From ", h("strong", {}, title)),
    h("span", {}, "Deleted ", h("time", { datetime: deletedAt }, when.format(new Date(deletedAt)))),
  );

/**
 * @param {HTMLElement} container
 * @param {AdminState} state
 */
export function renderTrash(container, state) {
  if (!state.trash.length && !state.videoTrash.length) {
    container.replaceChildren(h("p", { class: "empty" }, "The trash is empty."));
    return;
  }
  const titles = projectTitles(state);
  const titleOf = (/** @type {string} */ slug) => titles.get(slug) ?? slug;
  // The cover of a video's project stands in for its poster (the poster photo may be gone).
  const coverOf = (/** @type {string} */ slug) => state.photos.find((p) => p.project === slug)?.id;

  const videoList =
    state.videoTrash.length > 0 &&
    h(
      "section",
      { class: "trash-section", "aria-labelledby": "trash-videos-title" },
      h("h3", { id: "trash-videos-title" }, "Videos"),
      h(
        "ul",
        { class: "grid", "aria-labelledby": "trash-videos-title" },
        ...state.videoTrash.map((v) => {
          const cover = coverOf(v.project);
          return h(
            "li",
            { class: "card vtrash", "data-video-id": v.id },
            h(
              "div",
              { class: "vposter" },
              cover === undefined
                ? h("span", { class: "vposter-empty" }, "Video")
                : h("img", { src: thumbUrl(cover), alt: "", loading: "lazy" }),
            ),
            h("p", { class: "vtitle" }, v.title),
            trashMeta(titleOf(v.project), v.deletedAt),
            h(
              "div",
              { class: "card-actions" },
              h(
                "button",
                {
                  type: "button",
                  class: "btn small",
                  "data-action": "restore-video",
                  "data-video-id": v.id,
                  "aria-label": `Restore the video "${v.title}"`,
                },
                "Restore",
              ),
            ),
          );
        }),
      ),
    );

  const photoList =
    state.trash.length > 0 &&
    h(
      "section",
      { class: "trash-section", "aria-labelledby": "trash-photos-title" },
      h("h3", { id: "trash-photos-title" }, "Photos"),
      h(
        "ul",
        { class: "grid", "aria-labelledby": "trash-photos-title" },
        ...state.trash.map((t) => {
          const title = titleOf(t.project);
          return h(
            "li",
            { class: "card", "data-id": t.id },
            photoHandle(t.id, `Deleted photo from ${title}`),
            trashMeta(title, t.deletedAt),
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

  container.replaceChildren(...[videoList, photoList].filter((el) => el instanceof HTMLElement));
}
