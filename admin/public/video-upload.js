// @ts-check
/**
 * "Add a video": a dialog asking for a title and a file, then showing upload progress and the
 * server's processing status (converting can take a minute or two). The dialog can be closed
 * while it works; the result is announced either way.
 * @typedef {import("../lib/types.ts").AdminState} AdminState
 * @typedef {import("../lib/types.ts").VideoJob} VideoJob
 */
import { getVideoJob, uploadVideo } from "./api.js";
import { checkTitle } from "./video-dialogs.js";

const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const POLL_MS = 700;
const ACCEPTED_EXTENSIONS = /\.(mp4|mov|m4v|webm)$/i;

const formatMB = (/** @type {number} */ bytes) => `${Math.round(bytes / 2 ** 20)} MB`;

/**
 * @param {{
 *   getState: () => AdminState | undefined,
 *   onAdded: (videoId: number) => Promise<void>,
 *   announce: (message: string, isError?: boolean) => void,
 * }} deps
 */
export function setupVideoUpload({ getState, onAdded, announce }) {
  const dialog = /** @type {HTMLDialogElement} */ (byId("video-upload-dialog"));
  const form = /** @type {HTMLFormElement} */ (byId("video-upload-form"));
  const titleInput = /** @type {HTMLInputElement} */ (byId("video-title"));
  const fileInput = /** @type {HTMLInputElement} */ (byId("video-file"));
  const progress = byId("video-progress");
  const bar = /** @type {HTMLProgressElement} */ (byId("video-progress-bar"));
  const status = byId("video-progress-text");
  const error = byId("video-upload-error");
  const submit = /** @type {HTMLButtonElement} */ (byId("video-upload-submit"));
  const cancel = byId("video-upload-cancel");
  let project = "";
  let isBusy = false;

  /** @param {string} text @param {number} fraction */
  function show(text, fraction) {
    progress.hidden = false;
    status.textContent = text;
    bar.value = fraction;
  }

  function reset() {
    form.reset();
    error.textContent = "";
    progress.hidden = true;
    submit.disabled = false;
    cancel.textContent = "Cancel";
  }

  /** @param {File} file @returns {string} a problem, or "" if the file looks acceptable */
  function problemWith(file) {
    const limits = getState()?.videoLimits;
    const isVideo = file.type.startsWith("video/") || ACCEPTED_EXTENSIONS.test(file.name);
    if (!isVideo) return `"${file.name}" isn't a video. Use MP4, MOV or WebM.`;
    if (limits && file.size > limits.maxUploadBytes) {
      return `"${file.name}" is ${formatMB(file.size)}; the limit is ${formatMB(limits.maxUploadBytes)}. Trim it first.`;
    }
    return "";
  }

  /** @param {string} jobId @param {string} title */
  async function follow(jobId, title) {
    for (;;) {
      const job = await getVideoJob(jobId);
      if (job.state === "done") return job;
      if (job.state === "error") throw new Error(job.message ?? "Processing failed.");
      const percent = Math.round(job.progress * 100);
      show(
        job.state === "queued"
          ? `"${title}": waiting for another video to finish…`
          : `${job.stage}… ${percent}%`,
        job.progress,
      );
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isBusy) return;
    const title = checkTitle(titleInput.value, error);
    if (title === null) return titleInput.focus();
    const file = fileInput.files?.[0];
    if (!file) {
      error.textContent = "Choose a video file.";
      return fileInput.focus();
    }
    const problem = problemWith(file);
    if (problem) {
      error.textContent = problem;
      return fileInput.focus();
    }

    isBusy = true;
    submit.disabled = true;
    cancel.textContent = "Close (keeps working)";
    try {
      show("Uploading… 0%", 0);
      const job = await uploadVideo(file, { project, title }, (f) =>
        show(`Uploading… ${Math.round(f * 100)}%`, f),
      );
      const done = await follow(job.id, title);
      show("Done", 1);
      if (done.video) await onAdded(done.video.id);
      announce(`Added the video "${title}".`);
      if (dialog.open) dialog.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : "The upload failed.";
      error.textContent = message;
      progress.hidden = true;
      if (!dialog.open) announce(message, true);
    } finally {
      isBusy = false;
      submit.disabled = false;
      cancel.textContent = "Cancel";
    }
  });

  return {
    /** @param {string} projectSlug */
    openFor(projectSlug) {
      if (isBusy) return dialog.showModal(); // show the one in progress
      reset();
      project = projectSlug;
      const title = getState()?.projects.find((p) => p.slug === projectSlug)?.title ?? projectSlug;
      byId("video-upload-project").textContent = `Adding to ${title}.`;
      dialog.showModal();
      titleInput.focus();
    },
    isBusy: () => isBusy,
  };
}
