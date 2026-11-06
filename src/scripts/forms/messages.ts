/**
 * Pure helpers for form UX: API result → friendly copy, no-JS redirect status (?sent / ?error),
 * zod issues → per-field errors. No DOM access here, so everything is unit-testable.
 * Each form kind has a CopySet (requests: book/quote; reviews), chosen in kinds.ts.
 */
import type { ApiResult } from "../../lib/forms/schema";

/**
 * Every error an ApiResult can carry, plus "network" (the request never got an answer). Derived from the
 * shared contract, so a new server code fails the typecheck until every CopySet has wording for it.
 */
export type ErrorCode = Extract<ApiResult, { ok: false }>["error"] | "network";

export const errorCopy: Record<ErrorCode, string> = {
  validation: "A few fields need a quick fix. They're highlighted below.",
  captcha: "The spam check didn't go through. It has been reset, so please try sending again.",
  rate_limited: "That's a lot of requests in a short time. Please wait a minute, then try again.",
  // Only /api/review sends daily_limit today; book and quote keep a generic line so the copy stays total.
  daily_limit: "You've hit today's limit for sending. Please try again tomorrow, or DM me if it can't wait.",
  too_large: "Those photos are too big to send. Try fewer photos, or smaller ones.",
  not_configured:
    "Email isn't set up on the site yet, so your message couldn't be delivered. Please DM me instead, or try again later.",
  server: "Something went wrong on my end and your request wasn't sent. Please try again in a moment.",
  network: "Couldn't reach the server. Check your connection and try again.",
};

export const successCopy = "Got it! Your request is on my bench. I'll reply by email, usually within a day.";

/** What a form says on success and for each error code. */
export type CopySet = { success: string; errors: Record<ErrorCode, string>; noJsValidation: string };

export const requestCopy: CopySet = {
  success: successCopy,
  errors: errorCopy,
  noJsValidation: "Some fields were missing or invalid. Please check the form and send it again.",
};

export const reviewCopy: CopySet = {
  success: "Thanks! Your review is in. It'll show up on the site once I've approved it.",
  errors: {
    ...errorCopy,
    rate_limited: "That's a lot of reviews in a short time. Please wait a minute, then try again.",
    daily_limit: "You've hit today's review limit. Please try again tomorrow.",
    too_large: "That review is too long to send. Please trim it a little and try again.",
    not_configured: "Reviews aren't switched on yet, so yours couldn't be saved. Please DM me instead, or try again later.",
    server: "Something went wrong on my end and your review wasn't saved. Please try again in a moment.",
  },
  noJsValidation: "Some fields were missing or invalid. Please check your review and send it again.",
};

const known = new Set<string>(Object.keys(errorCopy));
export const isErrorCode = (v: unknown): v is ErrorCode => typeof v === "string" && known.has(v);

export type Outcome =
  | { kind: "success"; message: string }
  | { kind: "error"; code: ErrorCode; message: string; fieldErrors?: Record<string, string[]> };

/** Interpret a parsed JSON body (or its absence) + HTTP status from /api/book, /api/quote or /api/review. */
export function outcomeFromResponse(status: number, body: unknown, copy: CopySet = requestCopy): Outcome {
  const r = body as Partial<ApiResult> | null;
  if (r && r.ok === true) return { kind: "success", message: copy.success };
  if (r && r.ok === false) {
    if (r.error === "validation" && "fieldErrors" in r && r.fieldErrors) {
      const fieldErrors = withoutHoneypot(r.fieldErrors);
      if (!fieldErrors) return { kind: "error", code: "server", message: copy.errors.server };
      return { kind: "error", code: "validation", message: copy.errors.validation, fieldErrors };
    }
    if (isErrorCode(r.error)) return { kind: "error", code: r.error, message: copy.errors[r.error] };
  }
  // No usable JSON: fall back on the HTTP status. A bare 429 can't say which limit it hit, so it gets the
  // short-wait copy (the common case) rather than turning someone away until tomorrow.
  const code: ErrorCode =
    status === 413 ? "too_large" : status === 429 ? "rate_limited" : status === 403 ? "captcha" : status === 503 ? "not_configured" : "server";
  return { kind: "error", code, message: copy.errors[code] };
}

/** Status for the no-JS fallback: the Worker 303-redirects back with ?sent=1 or ?error=<code>. */
export function outcomeFromQuery(search: string, copy: CopySet = requestCopy): Outcome | null {
  const q = new URLSearchParams(search);
  if (q.get("sent") === "1") return { kind: "success", message: copy.success };
  const err = q.get("error");
  if (err === null) return null;
  const code = isErrorCode(err) && err !== "network" ? err : "server";
  const message = code === "validation" ? copy.noJsValidation : copy.errors[code];
  return { kind: "error", code, message };
}

type Issue = { path: ReadonlyArray<PropertyKey>; message: string };

/** zod issues → { field: [messages] } using the top-level key (e.g. services[2] → services). */
export function fieldErrorsFromIssues(issues: ReadonlyArray<Issue>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const i of issues) {
    const key = i.path.length ? String(i.path[0]) : "_form";
    const list = (out[key] ??= []);
    if (!list.includes(i.message)) list.push(i.message);
  }
  return out;
}

/** Human labels used in the error summary (in form order). */
export const fieldLabels: Record<string, string> = {
  services: "Service",
  requestType: "Request type",
  name: "Name",
  email: "Email",
  phone: "Phone",
  delivery: "Delivery",
  message: "Message",
  photos: "Photos",
  rating: "Rating",
  service: "Service",
  source: "How you heard about Mod Labs",
  body: "Review",
  consent: "Consent",
};

/** Honeypot keys (schema key + field name). Never shown to people: a real visitor can't fill it. */
const HONEYPOT_KEYS = new Set(["hp", "hp_7f3"]);

/** Remove honeypot errors; returns null when nothing user-fixable is left. */
export function withoutHoneypot(errors: Record<string, string[]>): Record<string, string[]> | null {
  const out = Object.fromEntries(Object.entries(errors).filter(([k]) => !HONEYPOT_KEYS.has(k)));
  return Object.keys(out).length ? out : null;
}

export function summaryText(fieldErrors: Record<string, string[]>): string {
  const fields = Object.keys(fieldErrors).filter((k) => k !== "_form");
  const formMsg = fieldErrors._form?.[0];
  if (!fields.length) return formMsg ?? errorCopy.validation;
  const names = fields.map((f) => fieldLabels[f] ?? f);
  const lead = fields.length === 1 ? "1 field needs attention" : `${fields.length} fields need attention`;
  return `${formMsg ? `${formMsg} ` : ""}${lead}: ${names.join(", ")}.`;
}
