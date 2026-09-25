export interface Env {
  ASSETS: Fetcher;
  /** Cloudflare Turnstile secret (secret). Dev: always-pass test key in .dev.vars. */
  TURNSTILE_SECRET_KEY?: string;
  /** Resend API key (secret). Required when EMAIL_MODE is "send". */
  RESEND_API_KEY?: string;
  /** Inbox that receives leads. Required when EMAIL_MODE is "send". */
  LEAD_EMAIL_TO?: string;
  /** "log" = console only (honoured on localhost only); "send" (default) = deliver via Resend. */
  EMAIL_MODE?: string;
  /** Optional sender override once a domain is verified in Resend. */
  EMAIL_FROM?: string;
  /** Workers Rate Limiting binding (optional; in-memory fallback when absent). */
  FORM_RATE_LIMITER?: RateLimit;
}

export const DEFAULT_EMAIL_FROM = "Mod Labs <onboarding@resend.dev>";

export type EmailMode = "log" | "send";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase());
}

/** Cloudflare's published Turnstile dummy secrets (always pass / always fail / token already spent). */
export function isTestTurnstileSecret(secret: string): boolean {
  return /^[123]x0000/.test(secret.trim());
}

/**
 * The email mode that actually applies to this request. EMAIL_MODE=log is honoured only when the
 * request is to localhost, so a misconfigured production deploy can never return fake success.
 */
export function emailMode(env: Env, requestHostname: string): EmailMode {
  const wantsLog = env.EMAIL_MODE?.trim().toLowerCase() === "log";
  if (!wantsLog) return "send";
  if (isLocalHostname(requestHostname)) return "log";
  console.warn("EMAIL_MODE=log ignored: request host is not localhost; using send mode");
  return "send";
}
