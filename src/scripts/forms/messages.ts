/**
 * Pure helpers for form UX: API result → friendly copy, no-JS redirect status (?sent / ?error),
 * zod issues → per-field errors. No DOM access here, so everything is unit-testable.
 */
import type { ApiResult } from "../../lib/forms/schema";

export type ErrorCode = "validation" | "captcha" | "rate_limited" | "too_large" | "not_configured" | "server" | "network";

export const errorCopy: Record<ErrorCode, string> = {
  validation: "A few fields need a quick fix. They're highlighted below.",
  captcha: "The spam check didn't go through. It has been reset, so please try sending again.",
  rate_limited: "That's a lot of requests in a short time. Please wait a minute, then try again.",
  too_large: "Those photos are too big to send. Try fewer photos, or smaller ones.",
  not_configured:
    "Email isn't set up on the site yet, so your message couldn't be delivered. Please DM me instead, or try again later.",
  server: "Something went wrong on my end and your request wasn't sent. Please try again in a moment.",
  network: "Couldn't reach the server. Check your connection and try again.",
};

export const successCopy = "Got it! Your request is on my bench. I'll reply by email, usually within a day.";

const known = new Set<string>(Object.keys(errorCopy));
export const isErrorCode = (v: unknown): v is ErrorCode => typeof v === "string" && known.has(v);

export type Outcome =
  | { kind: "success"; message: string }
  | { kind: "error"; code: ErrorCode; message: string; fieldErrors?: Record<string, string[]> };

/** Interpret a parsed JSON body (or its absence) + HTTP status from /api/book or /api/quote. */
export function outcomeFromResponse(status: number, body: unknown): Outcome {
  const r = body as Partial<ApiResult> | null;
  if (r && r.ok === true) return { kind: "success", message: successCopy };
  if (r && r.ok === false) {
    if (r.error === "validation" && "fieldErrors" in r && r.fieldErrors) {
      return { kind: "error", code: "validation", message: errorCopy.validation, fieldErrors: r.fieldErrors };
    }
    if (isErrorCode(r.error)) return { kind: "error", code: r.error, message: errorCopy[r.error] };
  }
  // No usable JSON: fall back on the HTTP status
  const code: ErrorCode =
    status === 413 ? "too_large" : status === 429 ? "rate_limited" : status === 403 ? "captcha" : status === 503 ? "not_configured" : "server";
  return { kind: "error", code, message: errorCopy[code] };
}

/** Status for the no-JS fallback: the Worker 303-redirects back with ?sent=1 or ?error=<code>. */
export function outcomeFromQuery(search: string): Outcome | null {
  const q = new URLSearchParams(search);
  if (q.get("sent") === "1") return { kind: "success", message: successCopy };
  const err = q.get("error");
  if (err === null) return null;
  const code = isErrorCode(err) && err !== "network" ? err : "server";
  const message = code === "validation" ? "Some fields were missing or invalid. Please check the form and send it again." : errorCopy[code];
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
  consent: "Consent",
  company: "Form",
};

export function summaryText(fieldErrors: Record<string, string[]>): string {
  const fields = Object.keys(fieldErrors).filter((k) => k !== "_form");
  const formMsg = fieldErrors._form?.[0];
  if (!fields.length) return formMsg ?? errorCopy.validation;
  const names = fields.map((f) => fieldLabels[f] ?? f);
  const lead = fields.length === 1 ? "1 field needs attention" : `${fields.length} fields need attention`;
  return `${formMsg ? `${formMsg} ` : ""}${lead}: ${names.join(", ")}.`;
}
