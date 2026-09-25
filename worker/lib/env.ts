export interface Env {
  ASSETS: Fetcher;
  /** Cloudflare Turnstile secret (secret). Dev: always-pass test key in .dev.vars. */
  TURNSTILE_SECRET_KEY?: string;
  /** Resend API key (secret). Required when EMAIL_MODE is "send". */
  RESEND_API_KEY?: string;
  /** Inbox that receives leads. Required when EMAIL_MODE is "send". */
  LEAD_EMAIL_TO?: string;
  /** "log" = console only (dev/tests); "send" (default) = deliver via Resend. */
  EMAIL_MODE?: string;
  /** Optional sender override once a domain is verified in Resend. */
  EMAIL_FROM?: string;
  /** Workers Rate Limiting binding (optional; in-memory fallback when absent). */
  FORM_RATE_LIMITER?: RateLimit;
}

export const DEFAULT_EMAIL_FROM = "Mod Labs <onboarding@resend.dev>";

export type EmailMode = "log" | "send";

export function emailMode(env: Env): EmailMode {
  return env.EMAIL_MODE?.trim().toLowerCase() === "log" ? "log" : "send";
}
