/**
 * Photo attachments for the quote form: pick or drop images, downscale each to a ≤1600px JPEG on the
 * device (one at a time: phone memory), show thumbnails with remove buttons, and hand the processed
 * files to the submit step. Files picked before this script loaded (slow connection) are adopted.
 * Rules and image processing are pure helpers in photos.ts.
 */
import { checkFiles, DecodeError, decodeErrorMessage, formatBytes, prepareImage } from "./photos";

type Attached = { id: number; file: File; url: string };
export type PhotoPicker = {
  /** resolves once every picked photo has been processed */
  ready: () => Promise<void>;
  isBusy: () => boolean;
  files: () => File[];
  reset: () => void;
};

const REMOVE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export function attachPhotoPicker(form: HTMLFormElement, announce: (text: string) => void): PhotoPicker | null {
  const input = form.querySelector<HTMLInputElement>('input[type="file"][name="photos"]');
  const thumbs = form.querySelector<HTMLUListElement>("[data-thumbs]");
  if (!input || !thumbs) return null;
  const maxFiles = Number(form.dataset.maxFiles) || 3;
  const maxBytes = Number(form.dataset.maxBytes) || 2_000_000;
  const dropzone = form.querySelector<HTMLElement>("[data-dropzone]");

  let attached: Attached[] = [];
  let pending = 0;
  let nextId = 1;
  let queue: Promise<void> = Promise.resolve();

  const showErrors = (msgs: string[]) => {
    const el = form.querySelector<HTMLElement>('[data-error-for="photos"]');
    if (el) el.textContent = msgs.join(" ");
  };

  const renderThumb = (a: Attached) => {
    const li = document.createElement("li");
    li.dataset.id = String(a.id);
    const img = document.createElement("img");
    img.src = a.url;
    img.alt = `Attached photo: ${a.file.name}`;
    const meta = document.createElement("span");
    meta.className = "thumb-meta";
    meta.textContent = formatBytes(a.file.size);
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "thumb-remove";
    rm.setAttribute("aria-label", `Remove ${a.file.name}`);
    rm.innerHTML = REMOVE_ICON;
    rm.addEventListener("click", () => {
      URL.revokeObjectURL(a.url);
      attached = attached.filter((x) => x.id !== a.id);
      const neighbour = li.nextElementSibling?.querySelector("button") ?? li.previousElementSibling?.querySelector("button");
      li.remove();
      showErrors([]);
      announce(`Removed ${a.file.name}. ${attached.length} of ${maxFiles} photos attached.`);
      if (neighbour instanceof HTMLElement) neighbour.focus();
      else input.focus();
    });
    li.append(img, meta, rm);
    return li;
  };

  const processOne = async (file: File, errors: string[]) => {
    const placeholder = document.createElement("li");
    placeholder.innerHTML = '<span class="thumb-busy">Preparing…</span>';
    thumbs.append(placeholder);
    try {
      const ready = await prepareImage(file, maxBytes);
      const a = { id: nextId++, file: ready, url: URL.createObjectURL(ready) };
      attached.push(a);
      placeholder.replaceWith(renderThumb(a));
    } catch (err) {
      placeholder.remove();
      errors.push(err instanceof DecodeError ? err.message : decodeErrorMessage(file.name));
      showErrors(errors);
    } finally {
      pending--;
    }
  };

  const addFiles = (files: File[]) => {
    if (!files.length) return;
    const { accept, errors } = checkFiles(files, attached.length + pending, maxFiles);
    showErrors(errors);
    pending += accept.length;
    queue = queue.then(async () => {
      for (const file of accept) await processOne(file, errors);
      if (accept.length) announce(`${attached.length} of ${maxFiles} photos attached.`);
    });
  };

  const takeInputFiles = () => {
    const files = Array.from(input.files ?? []);
    input.value = ""; // the processed copies are sent instead of the originals
    addFiles(files);
  };
  input.addEventListener("change", takeInputFiles);
  takeInputFiles();

  if (dropzone) {
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.dataset.drag = "";
    });
    dropzone.addEventListener("dragleave", () => delete dropzone.dataset.drag);
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      delete dropzone.dataset.drag;
      addFiles(Array.from(e.dataTransfer?.files ?? []));
    });
  }

  return {
    ready: () => queue,
    isBusy: () => pending > 0,
    files: () => attached.map((a) => a.file),
    reset: () => {
      attached.forEach((a) => URL.revokeObjectURL(a.url));
      attached = [];
      thumbs.textContent = "";
    },
  };
}
