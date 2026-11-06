/**
 * Progressive enhancement for every form[data-lab-form] (book, quote, review; see kinds.ts):
 * - validates with the SAME zod schema as the Worker (lazy-loaded on first interaction)
 * - inline field errors (aria-invalid + aria-describedby), focus on the first invalid control, polite summary
 * - fetch with Accept: application/json, friendly copy for every ApiResult code (per-kind CopySet)
 * - Turnstile loaded + rendered on first interaction (not page load), reset after failures
 * - live character counters ([data-count-for="<textarea id>"]), URL prefill, quote photos (photo-picker.ts)
 * - no-JS round trip: shows ?sent=1 / ?error=code status on load
 * Markup comes from components/forms/FormShell.astro.
 */
import { fieldErrorsFromIssues, outcomeFromQuery, outcomeFromResponse, summaryText, withoutHoneypot, type Outcome } from "./messages";
import { formKinds, isFormKind, type FormKind, type Validator } from "./kinds";
import { attachPhotoPicker } from "./photo-picker";
import { prefillFromUrl } from "./prefill";
import { FIRST_INTERACTION_EVENTS, loadTurnstile } from "./turnstile";

for (const form of document.querySelectorAll<HTMLFormElement>("form[data-lab-form]")) {
  const kind = form.dataset.labForm;
  if (isFormKind(kind)) enhance(form, kind);
}

function enhance(form: HTMLFormElement, kind: FormKind) {
  const { copy, loadValidator } = formKinds[kind];
  const shell = form.closest<HTMLElement>("[data-form-shell]");
  const status = form.querySelector<HTMLElement>(".form-status");
  const success = shell?.querySelector<HTMLElement>("[data-success]");
  const submit = form.querySelector<HTMLButtonElement>("[data-submit]");
  const submitLabel = submit?.querySelector<HTMLElement>("[data-submit-label]");
  if (!shell || !status || !success || !submit || !submitLabel) return;
  const idleLabel = submitLabel.textContent ?? "Send";
  let busy = false;

  let validator: Promise<Validator> | undefined;
  const getValidator = () => (validator ??= loadValidator());
  form.noValidate = true; // our validation replaces the native bubbles when JS runs
  form.addEventListener("focusin", () => void getValidator().catch(() => undefined), { once: true });

  /* ---------- status + errors ---------- */
  const setStatus = (tone: "error" | "success" | "info" | null, text = "") => {
    status.textContent = text;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  };
  const errorSlot = (name: string) => form.querySelector<HTMLElement>(`[data-error-for="${CSS.escape(name)}"]`);
  const controlsFor = (name: string) => Array.from(form.querySelectorAll<HTMLElement>(`[name="${CSS.escape(name)}"]`));

  const clearField = (name: string) => {
    const el = errorSlot(name);
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
      const el = errorSlot(name);
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
    if (!t.name) return;
    // grouped controls (checkbox/radio sets) clear on any change; single fields once they were flagged
    if (t.getAttribute("aria-invalid") || t.type === "checkbox" || t.type === "radio") clearField(t.name);
  };
  form.addEventListener("input", onFieldEdit);
  form.addEventListener("change", onFieldEdit);

  /* ---------- live character counters ---------- */
  const counters = Array.from(form.querySelectorAll<HTMLElement>("[data-count-for]")).flatMap((out) => {
    const field = form.querySelector<HTMLTextAreaElement | HTMLInputElement>(`#${CSS.escape(out.dataset.countFor ?? "")}`);
    return field ? [{ out, field }] : [];
  });
  const updateCounters = () => counters.forEach(({ out, field }) => (out.textContent = String(field.value.length)));
  counters.forEach(({ field }) => field.addEventListener("input", updateCounters));
  updateCounters();

  /* ---------- Turnstile ---------- */
  const tsSlot = form.querySelector<HTMLElement>("[data-turnstile]");
  let tsWidget: string | undefined;
  const showTurnstileError = () => {
    const el = errorSlot("cf-turnstile-response");
    if (el) el.textContent = "The spam check couldn't load. Refresh the page, or try another browser.";
  };
  /** Load + render the widget once, on the first interaction (see turnstile.ts for why). */
  const startTurnstile = async () => {
    if (!tsSlot || tsWidget !== undefined) return;
    let turnstile;
    try {
      turnstile = await loadTurnstile();
    } catch {
      showTurnstileError();
      return;
    }
    if (tsWidget !== undefined) return; // another interaction won the race
    tsWidget = turnstile.render(tsSlot, {
      sitekey: tsSlot.dataset.sitekey,
      action: tsSlot.dataset.action,
      theme: "dark",
      size: "flexible",
      "response-field-name": "cf-turnstile-response",
      "error-callback": showTurnstileError,
    });
  };
  for (const type of FIRST_INTERACTION_EVENTS) form.addEventListener(type, () => void startTurnstile(), { once: true });
  const resetTurnstile = () => {
    if (window.turnstile && tsWidget !== undefined) window.turnstile.reset(tsWidget);
  };

  /* ---------- prefill + photos ---------- */
  const params = new URLSearchParams(location.search);
  prefillFromUrl(form, kind, params);
  const photos = attachPhotoPicker(form, (text) => setStatus("info", text));

  /* ---------- success / reset ---------- */
  const showSuccess = (message: string) => {
    const msg = success.querySelector<HTMLElement>("[data-success-message]");
    if (msg) msg.textContent = message;
    form.hidden = true;
    success.hidden = false;
    success.focus();
    success.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const resetAll = () => {
    form.reset(); // also fires "reset" for widgets like the star rating
    photos?.reset();
    clearErrors();
    setStatus(null);
    requestAnimationFrame(updateCounters);
    resetTurnstile();
  };
  shell.querySelector("[data-again]")?.addEventListener("click", () => {
    resetAll();
    success.hidden = true;
    form.hidden = false;
    form.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")?.focus();
  });

  /* ---------- no-JS round trip result ---------- */
  const fromQuery = outcomeFromQuery(location.search, copy);
  if (fromQuery) {
    if (fromQuery.kind === "success") showSuccess(fromQuery.message);
    else setStatus("error", fromQuery.message);
    params.delete("sent");
    params.delete("error");
    const qs = params.toString();
    history.replaceState(history.state, "", `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`);
  }

  /* ---------- submit ---------- */
  const setBusy = (on: boolean, label = "Sending…") => {
    busy = on;
    submit.disabled = on;
    submit.setAttribute("aria-busy", String(on));
    submitLabel.textContent = on ? label : idleLabel;
  };

  /** Validate, then send. Returns undefined when the form stopped itself (invalid, captcha pending). */
  const send = async (): Promise<Outcome | undefined> => {
    if (photos) await photos.ready(); // never send while photos are still being prepared
    const fd = new FormData(form);
    if (photos) {
      fd.delete("photos");
      photos.files().forEach((f) => fd.append("photos", f, f.name));
    }

    let validate: Validator | undefined;
    try {
      validate = await getValidator();
    } catch {
      validate = undefined; // validation chunk failed to load: let the server validate
    }
    const issues = validate?.(fd);
    // honeypot errors are never shown: a person can't see that field
    const errors = issues ? withoutHoneypot(fieldErrorsFromIssues(issues)) : null;
    if (errors) {
      showFieldErrors(errors);
      return undefined;
    }

    if (tsSlot && !fd.get("cf-turnstile-response")) {
      void startTurnstile(); // no-op once started
      setStatus("info", "One sec: the spam check above the button is still finishing. Try again in a moment.");
      return undefined;
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
      return outcomeFromResponse(res.status, body, copy);
    } catch {
      return { kind: "error", code: "network", message: copy.errors.network };
    }
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true, photos?.isBusy() ? "Preparing photos…" : "Sending…"); // before any await: no double submits
    let outcome: Outcome | undefined;
    try {
      outcome = await send();
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
