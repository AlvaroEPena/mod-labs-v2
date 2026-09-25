import type { ApiResult } from "../../src/lib/forms/schema";

/** Security headers for every response the Worker generates (static assets get theirs from public/_headers). */
export const API_SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};

export type ErrorCode = Exclude<ApiResult, { ok: true }> extends infer E
  ? E extends { error: infer C }
    ? C
    : never
  : never;

/** HTTP status for each error code in the contract. */
export const STATUS_BY_ERROR: Record<ErrorCode, number> = {
  validation: 400,
  captcha: 403,
  too_large: 413,
  rate_limited: 429,
  not_configured: 503,
  server: 500,
};

export function wantsJson(request: Request): boolean {
  return (request.headers.get("Accept") ?? "").toLowerCase().includes("application/json");
}

function withSecurityHeaders(headers: HeadersInit = {}): Headers {
  const h = new Headers(headers);
  for (const [k, v] of Object.entries(API_SECURITY_HEADERS)) if (!h.has(k)) h.set(k, v);
  return h;
}

export function jsonResponse(body: ApiResult, status: number, extraHeaders: HeadersInit = {}): Response {
  const headers = withSecurityHeaders(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

export function redirectResponse(location: string): Response {
  return new Response(null, { status: 303, headers: withSecurityHeaders({ Location: location }) });
}

/** A result plus the HTTP status it should be sent with (status only matters for JSON clients). */
export interface Outcome {
  result: ApiResult;
  status: number;
}

export const success = (message: string): Outcome => ({ result: { ok: true, message }, status: 200 });

export function failure(
  error: Exclude<ErrorCode, "validation">,
  message: string,
  status: number = STATUS_BY_ERROR[error],
): Outcome {
  return { result: { ok: false, error, message }, status };
}

export function validationFailure(fieldErrors: Record<string, string[]>): Outcome {
  return { result: { ok: false, error: "validation", fieldErrors }, status: STATUS_BY_ERROR.validation };
}

/**
 * Content negotiation: fetch() clients sending Accept: application/json get JSON;
 * plain no-JS form posts get a 303 back to the form page (?sent=1 or ?error=<code>).
 */
export function respond(request: Request, pagePath: string, outcome: Outcome): Response {
  if (wantsJson(request)) return jsonResponse(outcome.result, outcome.status);
  const target = new URL(pagePath, request.url);
  if (outcome.result.ok) target.searchParams.set("sent", "1");
  else target.searchParams.set("error", outcome.result.error);
  return redirectResponse(target.toString());
}
