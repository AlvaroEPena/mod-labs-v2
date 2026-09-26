// @ts-check
/**
 * The "Videos" strip shown above each project's photos (like the site, where videos get their own
 * row above the photo grid). Each video card shows its poster with a play button, its title, and
 * its actions. Drag to reorder works like photos (see sortable.js with `.vcard` / `.video-list`).
 * @typedef {import("../lib/types.ts").AdminState} AdminState
 * @typedef {import("../lib/types.ts").AdminVideo} AdminVideo
 */
import { thumbUrl } from "./api.js";
import { h, icon, iconButton, plural } from "./dom.js";

/**
 * @param {AdminVideo} video
 * @param {number} index
 * @param {number} total
 * @param {string} projectTitle
 */
function videoCard(video, index, total, projectTitle) {
  const where = `video ${index + 1} of ${total} in ${projectTitle}`;
  const poster =
    video.posterThumbId === null
      ? h("span", { class: "vposter-empty" }, "No poster yet")
      : h("img", {
          src: thumbUrl(video.posterThumbId),
          alt: "",
          loading: "lazy",
          decoding: "async",
          draggable: "false",
        });
  return h(
    "li",
    { class: "vcard", "data-id": video.id, "data-project": video.project },
    h(
      "button",
      {
        type: "button",
        class: "vposter",
        "data-action": "play",
        "aria-label": `Play "${video.title}" (${where})`,
      },
      poster,
      h("span", { class: "play" }, icon("play")),
    ),
    h("p", { class: "vtitle" }, video.title),
    h(
      "p",
      { class: "card-meta" },
      h("span", { class: "pos" }, `#${index + 1}`),
      h("span", {}, video.posterId === undefined ? "Poster: auto" : `Poster: photo ${video.posterId}`),
    ),
    h(
      "div",
      { class: "card-actions" },
      iconButton(`Move "${video.title}" earlier`, "left", {
        "data-action": "earlier",
        disabled: index === 0,
      }),
      iconButton(`Move "${video.title}" later`, "right", {
        "data-action": "later",
        disabled: index === total - 1,
      }),
      h(
        "button",
        {
          type: "button",
          class: "btn small",
          "data-action": "rename",
          "aria-label": `Rename "${video.title}"`,
        },
        "Rename…",
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn small",
          "data-action": "poster",
          "aria-label": `Choose poster for "${video.title}"`,
        },
        "Poster…",
      ),
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
          "aria-label": `Move "${video.title}" to another project`,
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
          "aria-label": `Delete "${video.title}"`,
        },
        icon("trash"),
        "Delete",
      ),
    ),
  );
}

/**
 * @param {AdminState} state
 * @param {{ slug: string, title: string }} project
 */
export function videoStrip(state, project) {
  const videos = state.videos.filter((v) => v.project === project.slug);
  const headingId = `videos-${project.slug}`;
  return h(
    "section",
    { class: "videos", "aria-labelledby": headingId },
    h(
      "div",
      { class: "videos-head" },
      h("h4", { id: headingId }, "Videos"),
      h("span", { class: "count" }, videos.length ? plural(videos.length, "video") : "none yet"),
      h(
        "button",
        { type: "button", class: "link-btn", "data-action": "add-video", "data-project": project.slug },
        "Add a video",
      ),
    ),
    videos.length > 0 &&
      h(
        "ol",
        { class: "video-list", "data-project": project.slug, "aria-labelledby": headingId },
        ...videos.map((v, i) => videoCard(v, i, videos.length, project.title)),
      ),
  );
}
