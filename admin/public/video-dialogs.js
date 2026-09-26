// @ts-check
/**
 * Small dialogs for one video: rename, choose a poster, and play. (The upload dialog lives in
 * video-upload.js.) Native <dialog> handles focus trapping and Esc.
 * @typedef {import("../lib/types.ts").AdminState} AdminState
 * @typedef {import("../lib/types.ts").AdminVideo} AdminVideo
 */
import { thumbUrl, videoUrl } from "./api.js";
import { h } from "./dom.js";

const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const MAX_TITLE = 120;

/**
 * Open a form dialog and resolve with `read()` when submitted (if `read` returns a value), or
 * undefined when cancelled. `read` may return undefined to keep the dialog open (invalid input).
 * @template T
 * @param {HTMLDialogElement} dialog
 * @param {() => T | undefined} read
 * @returns {Promise<T | undefined>}
 */
function openForm(dialog, read) {
  const form = /** @type {HTMLFormElement} */ (dialog.querySelector("form"));
  return new Promise((resolve) => {
    /** @type {T | undefined} */
    let result;
    const onSubmit = (/** @type {SubmitEvent} */ e) => {
      e.preventDefault();
      const value = read();
      if (value === undefined) return;
      result = value;
      dialog.close("confirm");
    };
    form.addEventListener("submit", onSubmit);
    dialog.addEventListener(
      "close",
      () => {
        form.removeEventListener("submit", onSubmit);
        resolve(result);
      },
      { once: true },
    );
    dialog.showModal();
  });
}

/**
 * Checks a title the same way the server does (trimmed, 1–120 characters). Returns the clean
 * title, or null after showing the problem in `errorEl`.
 * @param {string} raw
 * @param {HTMLElement} errorEl
 */
export function checkTitle(raw, errorEl) {
  const title = raw.replace(/\s+/g, " ").trim();
  const problem = !title
    ? "Give the video a title."
    : title.length > MAX_TITLE
      ? `Keep it to ${MAX_TITLE} characters.`
      : "";
  errorEl.textContent = problem;
  return problem ? null : title;
}

/**
 * @param {AdminVideo} video
 * @returns {Promise<string | undefined>} the new title, or undefined if cancelled/unchanged
 */
export async function renameVideo(video) {
  const input = /** @type {HTMLInputElement} */ (byId("rename-input"));
  const error = byId("rename-error");
  input.value = video.title;
  error.textContent = "";
  const title = await openForm(/** @type {HTMLDialogElement} */ (byId("rename-dialog")), () => {
    const clean = checkTitle(input.value, error);
    if (clean === null) {
      input.focus();
      return undefined;
    }
    return clean;
  });
  return title === video.title ? undefined : title;
}

/**
 * Pick the poster from the video's project photos, or "Automatic" (the project cover).
 * @param {AdminState} state
 * @param {AdminVideo} video
 * @returns {Promise<number | null | undefined>} photo id, null for automatic, undefined if cancelled
 */
export async function choosePoster(state, video) {
  const photos = state.photos.filter((p) => p.project === video.project);
  const options = byId("poster-options");
  const current = video.posterId === undefined ? "auto" : String(video.posterId);
  /** @param {string} value @param {string} label @param {Node} picture */
  const option = (value, label, picture) =>
    h(
      "label",
      { class: "poster-option" },
      h("input", { type: "radio", name: "poster", value, checked: value === current }),
      picture,
      h("span", {}, label),
    );
  const cover = photos[0];
  const legend = options.querySelector("legend");
  options.replaceChildren(
    ...(legend ? [legend] : []),
    option(
      "auto",
      "Automatic (project cover)",
      cover
        ? h("img", { src: thumbUrl(cover.id), alt: "" })
        : h("span", { class: "vposter-empty" }, "No photos"),
    ),
    ...photos.map((p, i) =>
      option(String(p.id), `Photo ${i + 1}`, h("img", { src: thumbUrl(p.id), alt: "", loading: "lazy" })),
    ),
  );
  const dialog = /** @type {HTMLDialogElement} */ (byId("poster-dialog"));
  const choice = await openForm(dialog, () => {
    const checked = /** @type {HTMLInputElement | null} */ (options.querySelector("input:checked"));
    return checked?.value ?? "auto";
  });
  if (choice === undefined || choice === current) return undefined;
  return choice === "auto" ? null : Number(choice);
}

/** @param {{ id: number, title: string }} video */
export function playVideo(video) {
  const dialog = /** @type {HTMLDialogElement} */ (byId("player-dialog"));
  const player = /** @type {HTMLVideoElement} */ (byId("player"));
  byId("player-title").textContent = video.title;
  player.src = videoUrl(video.id);
  player.setAttribute("aria-label", video.title);
  dialog.addEventListener(
    "close",
    () => {
      player.pause();
      player.removeAttribute("src");
      player.load();
    },
    { once: true },
  );
  dialog.showModal();
  void player.play().catch(() => undefined); // autoplay may be blocked; the controls are there
}
