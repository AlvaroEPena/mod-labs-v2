// @ts-check
/**
 * The "Add photos" panel: pick a project, pick or drop files, upload them one at a time with a
 * progress bar and a clear message per file.
 * @typedef {import("../lib/types.ts").AdminState} AdminState
 * @typedef {{ file: File, row: HTMLLIElement, bar: HTMLProgressElement, msg: HTMLElement, status: "waiting" | "uploading" | "done" | "error" }} QueueItem
 */
import { uploadPhoto } from "./api.js";
import { h } from "./dom.js";

const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const formatBytes = (/** @type {number} */ n) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;

/**
 * @param {{ getState: () => AdminState | undefined, onUploaded: (state: AdminState, id: number) => void, announce: (message: string, isError?: boolean) => void }} deps
 */
export function setupUpload({ getState, onUploaded, announce }) {
  const select = /** @type {HTMLSelectElement} */ (byId("upload-project"));
  const input = /** @type {HTMLInputElement} */ (byId("upload-input"));
  const dropzone = byId("dropzone");
  const list = byId("upload-list");
  const startBtn = /** @type {HTMLButtonElement} */ (byId("upload-start"));
  const clearBtn = /** @type {HTMLButtonElement} */ (byId("upload-clear"));
  /** @type {QueueItem[]} */
  let queue = [];
  let isUploading = false;

  const waiting = () => queue.filter((q) => q.status === "waiting");

  function refreshControls() {
    const count = waiting().length;
    startBtn.disabled = isUploading || count === 0;
    startBtn.textContent = isUploading
      ? "Uploading…"
      : count
        ? `Upload ${count} photo${count === 1 ? "" : "s"}`
        : "Upload photos";
    clearBtn.hidden = isUploading || queue.length === 0;
    select.disabled = isUploading;
  }

  /** @param {QueueItem} item @param {QueueItem["status"]} status @param {string} message */
  function setItem(item, status, message) {
    item.status = status;
    item.row.className = `upload-item${status === "done" ? " is-done" : status === "error" ? " is-error" : ""}`;
    item.msg.textContent = message;
    item.bar.hidden = status !== "uploading";
  }

  /** @param {Iterable<File>} files */
  function addFiles(files) {
    const maxBytes = getState()?.limits.maxUploadBytes ?? Infinity;
    for (const file of files) {
      const bar = h("progress", {
        max: "1",
        value: "0",
        "aria-label": `Upload progress for ${file.name}`,
        hidden: true,
      });
      const msg = h("span", { class: "msg" }, "Ready to upload");
      const row = h(
        "li",
        { class: "upload-item" },
        h("span", { class: "name" }, file.name),
        h("span", { class: "size" }, formatBytes(file.size)),
        bar,
        msg,
      );
      /** @type {QueueItem} */
      const item = { file, row, bar, msg, status: "waiting" };
      list.append(row);
      queue.push(item);
      if (file.size > maxBytes)
        setItem(item, "error", `Too big: the limit is ${formatBytes(maxBytes)} per photo.`);
    }
    refreshControls();
  }

  async function start() {
    const project = select.value;
    if (!project) {
      announce("Choose which project the photos go in first.", true);
      select.focus();
      return;
    }
    isUploading = true;
    refreshControls();
    let done = 0;
    let failed = 0;
    for (const item of waiting()) {
      setItem(item, "uploading", "Uploading…");
      try {
        const result = await uploadPhoto(item.file, project, (fraction) => {
          item.bar.value = fraction;
          if (fraction >= 1) item.msg.textContent = "Processing…";
        });
        setItem(item, "done", `Added (id ${result.photo.id})`);
        onUploaded(result.state, result.photo.id);
        done++;
      } catch (err) {
        setItem(item, "error", err instanceof Error ? err.message : "Upload failed.");
        failed++;
      }
    }
    isUploading = false;
    refreshControls();
    const title = getState()?.projects.find((p) => p.slug === project)?.title ?? project;
    announce(
      failed
        ? `${done} photo${done === 1 ? "" : "s"} added to ${title}. ${failed} couldn't be uploaded; see the list for why.`
        : `${done} photo${done === 1 ? "" : "s"} added to ${title}.`,
      failed > 0,
    );
  }

  input.addEventListener("change", () => {
    if (input.files) addFiles(input.files);
    input.value = ""; // allow picking the same file again after clearing
  });
  for (const type of ["dragenter", "dragover"]) {
    dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      dropzone.classList.add("is-over");
    });
  }
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-over"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-over");
    if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
  });
  startBtn.addEventListener("click", start);
  clearBtn.addEventListener("click", () => {
    queue = [];
    list.replaceChildren();
    refreshControls();
    input.focus();
  });
  refreshControls();

  return {
    /** Preselect a project (from a project's "Add photos here" button) and bring the panel into view. */
    chooseProject(/** @type {string} */ slug) {
      select.value = slug;
      byId("upload-panel").scrollIntoView({ block: "start" });
      input.focus();
    },
    isBusy: () => isUploading,
  };
}
