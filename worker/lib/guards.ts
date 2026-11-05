/** Pipeline steps shared by every public form endpoint (book, quote, review). */
import type { BodyResult } from "./body";
import { isLocalHostname, isTestTurnstileSecret, type EmailMode, type Env } from "./env";
import { failure, validationFailure, type Outcome } from "./http";
import { verifyTurnstile } from "./integrations";

const NOT_SET_UP = "The form isn't set up yet. Please message me directly instead.";

/** Reject cross-site form posts (CSRF-style abuse). Same-origin fetch and form posts pass. */
export function isCrossSite(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (origin !== null) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) return true;
    } catch {
      return true; // "null" or malformed origin
    }
  }
  return request.headers.get("Sec-Fetch-Site") === "cross-site";
}

/** Map a failed bounded body read to the response the client gets. */
export function bodyReadFailure(
  reason: Extract<BodyResult, { ok: false }>["reason"],
  tooLargeMessage: string,
): Outcome {
  switch (reason) {
    case "length_required":
      return failure("too_large", "The upload couldn't be read (missing length). Please try again.", 411);
    case "too_large":
      return failure("too_large", tooLargeMessage);
    case "unsupported":
      return validationFailure({ _form: ["Unsupported form submission."] });
    default:
      return validationFailure({ _form: ["The form submission couldn't be read. Please try again."] });
  }
}

export interface CaptchaCheck {
  env: Env;
  mode: EmailMode;
  /** the submitted `cf-turnstile-response` value */
  token: string | File | null;
  ip: string | null;
  /** the request's hostname */
  hostname: string;
  /** Turnstile widget action this form renders with */
  action: string;
}

/**
 * Turnstile step: refuses a missing secret, refuses Cloudflare TEST secrets outside log mode,
 * then verifies the token (hostname + action). Returns null when the check passed.
 */
export async function checkCaptcha({
  env,
  mode,
  token,
  ip,
  hostname,
  action,
}: CaptchaCheck): Promise<Outcome | null> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    console.error("TURNSTILE_SECRET_KEY is not set");
    return failure("not_configured", NOT_SET_UP);
  }
  if (mode === "send" && isTestTurnstileSecret(secret)) {
    console.error(
      "TURNSTILE_SECRET_KEY is a Cloudflare TEST secret; refusing to send email. Set the real secret with `npx wrangler secret put TURNSTILE_SECRET_KEY`.",
    );
    return failure("not_configured", NOT_SET_UP);
  }
  // Test secrets report hostname "example.com", and local runs have no real hostname: skip that check there.
  const checkHostname = !isLocalHostname(hostname) && !isTestTurnstileSecret(secret);
  const verdict = await verifyTurnstile(secret, typeof token === "string" ? token : "", ip, {
    hostname: checkHostname ? hostname : null,
    action,
  });
  if (verdict === "failed") {
    return failure("captcha", "The spam check failed. Please complete the verification and try again.");
  }
  if (verdict === "unavailable") {
    return failure("server", "Couldn't verify the spam check right now. Please try again in a moment.", 502);
  }
  return null;
}
