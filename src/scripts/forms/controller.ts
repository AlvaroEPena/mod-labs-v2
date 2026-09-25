/**
 * Progressive enhancement for [data-lab-form] (book + quote).
 * - validates with the SAME zod schemas as the Worker (lazy-loaded on first interaction)
 * - inline field errors (aria-invalid + aria-describedby), focus first invalid, polite summary
 * - fetch with Accept: application/json, friendly copy for every ApiResult code
 * - Turnstile explicit render + reset after failures
 * - quote photos: pick/drop, downscale to ≤1600px JPEG, thumbnails with remove buttons
 * - no-JS round trip: shows ?sent=1 / ?error=code status on load
 */
import { errorCopy, fieldErrorsFromIssues, outcomeFromQuery, outcomeFromResponse, summaryText, withoutHoneypot, type Outcome } from "./messages";
import { checkFiles, DecodeError, decodeErrorMessage, formatBytes, prepareImage } from "./photos";

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  getResponse: (id?: string) => string | undefined;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

type Kind = "book" | "quote";
let validation: Promise<typeof import("../../lib/forms/schema")> | undefined;
const loadValidation = () => (validation ??= import("../../lib/forms/schema"));

for (const form of document.querySelectorAll<HTMLFormElement>("form[data-lab-form]")) enhance(form);

function enhance(form: HTMLFormElement) {
  const kind = form.dataset.labForm as Kind;
  const shell = form.closest<HTMLElement>("[data-form-shell]")!;
  const status = form.querySelector<HTMLElement>(".form-status")!;
  const success = shell.querySelector<HTMLElement>("[data-success]")!;
  const submit = form.querySelector<HTMLButtonElement>("[data-submit]")!;
  const submitLabel = submit.querySelector<HTMLElement>("[data-submit-label]")!;
  const idleLabel = submitLabel.textContent ?? "Send";
  const maxFiles = Number(form.dataset.maxFiles) || 3;
  const maxBytes = Number(form.dataset.maxBytes) || 2_000_000;
  let busy = false;

  form.noValidate = true; // our validation replaces the native bubbles when JS runs
  form.addEventListener("focusin", () => void loadValidation(), { once: true });

  /* ---------- status + errors ---------- */
  const setStatus = (tone: "error" | "success" | "info" | null, text = "") => {
    status.textContent = text;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  };

  const controlsFor = (name: string) => Array.from(form.querySelectorAll<HTMLElement>(`[name="${CSS.escape(name)}"]`));

  const clearField = (name: string) => {
    const el = form.querySelector<HTMLElement>(`[data-error-for="${CSS.escape(name)}"]`);
    if (el) el.textContent = "";
    controlsFor(name).forEach((c) => c.removeAttribute("aria-invalid"));
  };

  const clearErrors = () => {
    form.querySelectorAll<HTMLElement>("[data-error-for]").forEach((el) => (el.textContent = ""));
    form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  };

  const showFieldErrors = (errors: Record<string, string[]>) => {
    clearErrors();
    let first: HTMLElement | undefined;
    for (const [name, msgs] of Object.entries(errors)) {
      const el = form.querySelector<HTMLElement>(`[data-error-for="${CSS.escape(name)}"]`);
      if (el) el.textContent = msgs[0] ?? "";
      for (const c of controlsFor(name)) {
        c.setAttribute("aria-invalid", "true");
        if (!first || first.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_PRECEDING) first = c;
      }
    }
    setStatus("error", summaryText(errors));
    (first ?? status).focus({ preventScroll: false });
  };

  const onFieldEdit = (e: Event) => {
    const t = e.target as HTMLInputElement;
    if (t.name && t.getAttribute("aria-invalid")) clearField(t.name);
    if (t.name === "services" || t.name === "delivery") clearField(t.name);
  };
  form.addEventListener("input", onFieldEdit);
  form.addEventListener("change", onFieldEdit);

  /* ---------- message counter ---------- */
  const message = form.querySelector<HTMLTextAreaElement>('textarea[name="message"]');
  const counter = form.querySelector<HTMLElement>("[data-count]");
  const count = () => counter && message && (counter.textContent = String(message.value.length));
  message?.addEventListener("input", count);
  count();

  /* ---------- Turnstile ---------- */
  const tsSlot = form.querySelector<HTMLElement>("[data-turnstile]");
  let tsWidget: string | undefined;
  const mountTurnstile = () => {
    if (!tsSlot || tsWidget !== undefined || !window.turnstile) return;
    tsWidget = window.turnstile.render(tsSlot, {
      sitekey: tsSlot.dataset.sitekey,
      action: tsSlot.dataset.action,
      theme: "dark",
      size: "flexible",
      "response-field-name": "cf-turnstile-response",
      "error-callback": () => {
        const el = form.querySelector<HTMLElement>('[data-error-for="cf-turnstile-response"]');
        if (el) el.textContent = "The spam check couldn't load. Refresh the page, or try another browser.";
      },
    });
  };
  document.addEventListener("ml:turnstile", mountTurnstile);
  mountTurnstile();
  const resetTurnstile = () => {
    if (window.turnstile && tsWidget !== undefined) window.turnstile.reset(tsWidget);
  };

  /* ---------- prefill from the URL ---------- */
  const params = new URLSearchParams(location.search);
  if (kind === "book") {
    const id = params.get("service");
    const box = id ? form.querySelector<HTMLInputElement>(`input[data-service-id="${CSS.escape(id)}"]`) : null;
    if (box) box.checked = true;
  } else {
    const build = params.get("build");
    const map = JSON.parse(form.dataset.buildMap ?? "{}") as Record<string, string>;
    const select = form.querySelector<HTMLSelectElement>('select[name="requestType"]');
    if (build && select && map[build]) select.value = map[build];
  }

  /* ---------- no-JS round trip result ---------- */
  const fromQuery = outcomeFromQuery(location.search);
  if (fromQuery) {
    if (fromQuery.kind === "success") showSuccess(fromQuery.message);
    else setStatus("error", fromQuery.message);
    params.delete("sent");
    params.delete("error");
    const qs = params.toString();
    history.replaceState(history.state, "", `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`);
  }

  /* ---------- photos (quote only) ---------- */
  const photoInput = form.querySelector<HTMLInputElement>('input[type="file"][name="photos"]');
  const thumbs = form.querySelector<HTMLUListElement>("[data-thumbs]");
  const dropzone = form.querySelector<HTMLElement>("[data-dropzone]");
  type Attached = { id: number; file: File; url: string };
  let attached: Attached[] = [];
  let pendingPhotos = 0;
  let nextId = 1;

  const photoError = (msgs: string[]) => {
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
    rm.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    rm.addEventListener("click", () => {
      URL.revokeObjectURL(a.url);
      attached = attached.filter((x) => x.id !== a.id);
      const next = li.nextElementSibling?.querySelector("button") ?? li.previousElementSibling?.querySelector("button");
      li.remove();
      photoError([]);
      setStatus("info", `Removed ${a.file.name}. ${attached.length} of ${maxFiles} photos attached.`);
      if (next instanceof HTMLElement) next.focus();
      else photoInput?.focus();
    });
    li.append(img, meta, rm);
    return li;
  };

  /** Photos are processed strictly one at a time (phone memory); submit waits on this chain. */
  let photoQueue: Promise<void> = Promise.resolve();

  const processOne = async (file: File, errors: string[]) => {
    if (!thumbs) return;
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
      photoError(errors);
    } finally {
      pendingPhotos--;
    }
  };

  const addFiles = (files: File[]) => {
    if (!thumbs || !files.length) return photoQueue;
    const { accept, errors } = checkFiles(files, attached.length + pendingPhotos, maxFiles);
    photoError(errors);
    pendingPhotos += accept.length;
    photoQueue = photoQueue.then(async () => {
      for (const file of accept) await processOne(file, errors);
      if (accept.length) setStatus("info", `${attached.length} of ${maxFiles} photos attached.`);
    });
    return photoQueue;
  };

  const takeInputFiles = () => {
    if (!photoInput) return;
    const files = Array.from(photoInput.files ?? []);
    photoInput.value = ""; // processed copies are sent instead of the originals
    void addFiles(files);
  };
  photoInput?.addEventListener("change", takeInputFiles);
  // Files picked before this script loaded (slow connection): adopt them instead of dropping them.
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
      void addFiles(Array.from(e.dataTransfer?.files ?? []));
    });
  }

  /* ---------- submit ---------- */
  const setBusy = (on: boolean, label = "Sending…") => {
    busy = on;
    submit.disabled = on;
    submit.setAttribute("aria-busy", String(on));
    submitLabel.textContent = on ? label : idleLabel;
  };

  function showSuccess(message: string) {
    const msg = success.querySelector<HTMLElement>("[data-success-message]");
    if (msg) msg.textContent = message;
    form.hidden = true;
    success.hidden = false;
    success.focus();
    success.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  const resetAll = () => {
    form.reset();
    attached.forEach((a) => URL.revokeObjectURL(a.url));
    attached = [];
    if (thumbs) thumbs.textContent = "";
    clearErrors();
    setStatus(null);
    count();
    resetTurnstile();
  };

  shell.querySelector("[data-again]")?.addEventListener("click", () => {
    resetAll();
    success.hidden = true;
    form.hidden = false;
    form.querySelector<HTMLElement>("input, select, textarea")?.focus();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true, pendingPhotos > 0 ? "Preparing photos…" : "Sending…"); // before any await: no double submits
    let outcome: Outcome | undefined;
    try {
      // never send while photos are still being prepared
      await photoQueue;

      const fd = new FormData(form);
      fd.delete("photos");
      if (kind === "quote") attached.forEach((a) => fd.append("photos", a.file, a.file.name));

      let schema;
      try {
        schema = await loadValidation();
      } catch {
        schema = undefined; // validation chunk failed to load: let the server validate
      }
      if (schema) {
        const parsed = (kind === "book" ? schema.bookSchema : schema.quoteSchema).safeParse(schema.formDataToObject(fd));
        if (!parsed.success) {
          // honeypot errors are never shown: a person can't see that field
          const errors = withoutHoneypot(fieldErrorsFromIssues(parsed.error.issues));
          if (errors) {
            showFieldErrors(errors);
            return;
          }
        }
      }

      if (tsSlot && window.turnstile && tsWidget !== undefined && !fd.get("cf-turnstile-response")) {
        setStatus("info", "One sec: the spam check above the button is still finishing. Try again in a moment.");
        return;
      }

      clearErrors();
      setStatus(null);
      submitLabel.textContent = "Sending…";
      try {
        const res = await fetch(form.action, { method: "POST", body: fd, headers: { Accept: "application/json" } });
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        outcome = outcomeFromResponse(res.status, body);
      } catch {
        outcome = { kind: "error", code: "network", message: errorCopy.network };
      }
    } finally {
      setBusy(false);
    }
    if (!outcome) return;

    if (outcome.kind === "success") {
      resetAll();
      showSuccess(outcome.message);
      return;
    }
    resetTurnstile(); // tokens are single-use
    if (outcome.fieldErrors) showFieldErrors(outcome.fieldErrors);
    else {
      setStatus("error", outcome.message);
      status.focus();
    }
  });
}
