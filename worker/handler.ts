import { fieldNames } from "../src/lib/forms/schema";
import { renderEmail, toAttachments } from "./lib/email";
import { readFormDataLimited } from "./lib/body";
import { DEFAULT_EMAIL_FROM, emailMode, isLocalHostname, isTestTurnstileSecret, type Env } from "./lib/env";
import { failure, jsonResponse, respond, success, validationFailure, type Outcome } from "./lib/http";
import { sendViaResend, verifyTurnstile } from "./lib/integrations";
import { allowRequest } from "./lib/ratelimit";
import { isHoneypotTripped, validateFields, validatePhotos, type FormKind, type Photo } from "./lib/validate";

/** Reject request bodies above this before parsing (3 × 2 MB photos + text + multipart overhead). */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

const ROUTES: Record<string, { kind: FormKind; page: string }> = {
  "/api/book": { kind: "book", page: "/book" },
  "/api/quote": { kind: "quote", page: "/quote" },
};

/** Per-isolate count of honeypot trips (logged; no PII). */
let honeypotTrips = 0;

const SUCCESS_MESSAGE = "Thanks! Your request is in — I'll get back to you by email soon.";

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

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const route = ROUTES[url.pathname];

  if (!route) {
    return jsonResponse({ ok: false, error: "server", message: "Not found." }, 404);
  }
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "server", message: "Method not allowed." }, 405, { Allow: "POST" });
  }
  if (isCrossSite(request)) {
    return respond(request, route.page, failure("server", "Cross-site requests are not allowed.", 403));
  }

  let outcome: Outcome;
  try {
    outcome = await processSubmission(request, env, route.kind, url.hostname);
  } catch (err) {
    console.error("form handler error", err instanceof Error ? err.name : "unknown");
    outcome = failure("server", "Something went wrong on our side. Please try again or message me directly.");
  }
  return respond(request, route.page, outcome);
}

async function processSubmission(request: Request, env: Env, kind: FormKind, hostname: string): Promise<Outcome> {
  const ip = request.headers.get("CF-Connecting-IP");

  // 1. Abuse limit (cheap, before touching the body)
  if (!(await allowRequest(env, `form:${ip ?? "unknown"}`))) {
    return failure("rate_limited", "Too many requests. Please wait a minute and try again.");
  }

  // 2+3. Size guard (Content-Length required, and enforced again while streaming) + parse
  const body = await readFormDataLimited(request, MAX_BODY_BYTES);
  if (!body.ok) {
    switch (body.reason) {
      case "length_required":
        return failure("too_large", "The upload couldn't be read (missing length). Please try again.", 411);
      case "too_large":
        return failure("too_large", "That upload is too large. Attach up to 3 photos of 2 MB each.");
      case "unsupported":
        return validationFailure({ _form: ["Unsupported form submission."] });
      default:
        return validationFailure({ _form: ["The form submission couldn't be read. Please try again."] });
    }
  }
  const fd = body.formData;

  // 4. Honeypot: pretend success, send nothing
  if (isHoneypotTripped(fd)) {
    honeypotTrips += 1;
    console.warn("honeypot tripped", JSON.stringify({ kind, isolateCount: honeypotTrips }));
    return success(SUCCESS_MESSAGE);
  }

  // 5. Turnstile
  const mode = emailMode(env, hostname);
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    console.error("TURNSTILE_SECRET_KEY is not set");
    return failure("not_configured", "The form isn't set up yet. Please message me directly instead.");
  }
  if (mode === "send" && isTestTurnstileSecret(secret)) {
    console.error(
      "TURNSTILE_SECRET_KEY is a Cloudflare TEST secret; refusing to send email. Set the real secret with `npx wrangler secret put TURNSTILE_SECRET_KEY`.",
    );
    return failure("not_configured", "The form isn't set up yet. Please message me directly instead.");
  }
  const token = fd.get(fieldNames.turnstile);
  // Test secrets report hostname "example.com", and local runs have no real hostname: skip that check there.
  const checkHostname = !isLocalHostname(hostname) && !isTestTurnstileSecret(secret);
  const verdict = await verifyTurnstile(secret, typeof token === "string" ? token : "", ip, {
    hostname: checkHostname ? hostname : null,
    action: kind,
  });
  if (verdict === "failed") {
    return failure("captcha", "The spam check failed. Please complete the verification and try again.");
  }
  if (verdict === "unavailable") {
    return failure("server", "Couldn't verify the spam check right now. Please try again in a moment.", 502);
  }

  // 6. Field validation (shared contract)
  const validation = validateFields(kind, fd);
  if (!validation.ok) return validationFailure(validation.fieldErrors);

  // 7. Photos (quote only)
  let photos: Photo[] = [];
  if (kind === "quote") {
    const pr = await validatePhotos(fd);
    if (!pr.ok) {
      return pr.reason === "too_large" ? failure("too_large", pr.message) : validationFailure(pr.fieldErrors);
    }
    photos = pr.photos;
  }

  // 8. Email
  const email = renderEmail(validation.submission, photos);
  const logSummary = () =>
    console.log(
      "[form email]",
      JSON.stringify({
        mode,
        kind,
        subject: email.subject,
        to: env.LEAD_EMAIL_TO ?? null,
        replyTo: email.replyTo,
        attachments: photos.map((p) => ({ name: p.name, type: p.type, size: p.size })),
        text: email.text,
      }),
    );

  if (mode === "log") {
    logSummary();
    return success(SUCCESS_MESSAGE);
  }

  if (!env.RESEND_API_KEY || !env.LEAD_EMAIL_TO) {
    console.error("email not configured: RESEND_API_KEY and LEAD_EMAIL_TO are required when EMAIL_MODE=send");
    return failure("not_configured", "Email isn't set up yet. Please message me directly instead.");
  }

  const sent = await sendViaResend({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM,
    to: env.LEAD_EMAIL_TO,
    email,
    attachments: await toAttachments(photos),
  });
  if (!sent) {
    return failure("server", "Your request couldn't be sent right now. Please try again or message me directly.", 502);
  }
  return success(SUCCESS_MESSAGE);
}
