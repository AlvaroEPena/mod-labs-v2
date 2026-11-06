/**
 * POST /api/review (spec §17 step 1, §18). Same pipeline as book/quote:
 * origin → rate limit → bounded body → honeypot → Turnstile ("review") → reviewSchema → daily limits
 * (site-wide, then per visitor) → insert pending → moderation email with signed Approve/Delete links
 * → ApiResult (JSON) or 303 back to /reviews.
 */
import {
  reviewFields,
  reviewFormToObject,
  reviewSchema,
  type ReviewInput,
} from "../../src/lib/reviews/contract";
import { readFormDataLimited } from "../lib/body";
import { DEFAULT_EMAIL_FROM, emailMode } from "../lib/env";
import { bodyReadFailure, checkCaptcha, isCrossSite } from "../lib/guards";
import { failure, jsonResponse, respond, success, validationFailure, type Outcome } from "../lib/http";
import { sendViaResend } from "../lib/integrations";
import { allowReviewRequest } from "../lib/ratelimit";
import { isHoneypotTripped, toFieldErrors } from "../lib/validate";
import type { ReviewContext } from "./context";
import { renderModerationEmail, type ModerationLinks } from "./moderation-email";
import { createModerationLink, signingKeyFrom } from "./signing";
import type { NewReview } from "./store";
import { consumeVisitorAllowance, MAX_REVIEWS_PER_VISITOR_PER_DAY } from "./visitor-limit";

export const REVIEW_PAGE = "/reviews";
/** Text fields + a Turnstile token fit in a few KB; nothing legitimate comes close to this. */
export const MAX_REVIEW_BODY_BYTES = 16 * 1024;
/**
 * Global cap on new reviews per rolling 24 h. Bounds moderation emails (the Resend quota is shared
 * with booking/quote leads) even if someone rotates IPs and solves Turnstile repeatedly.
 */
export const MAX_NEW_REVIEWS_PER_DAY = 20;
const DAY_MS = 86_400_000;

const SUCCESS_MESSAGE = "Thanks for the review! It'll show up on the site once it's approved.";
const NOT_SET_UP = "Reviews aren't set up yet. Please message me directly instead.";

let honeypotTrips = 0;

export async function handleReviewSubmit(request: Request, ctx: ReviewContext): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "server", message: "Method not allowed." }, 405, {
      Allow: "POST",
    });
  }
  if (isCrossSite(request)) {
    return respond(request, REVIEW_PAGE, failure("server", "Cross-site requests are not allowed.", 403));
  }
  let outcome: Outcome;
  try {
    outcome = await processReview(request, ctx);
  } catch (err) {
    console.error("review handler error", err instanceof Error ? err.name : "unknown");
    outcome = failure("server", "Something went wrong on our side. Please try again or message me directly.");
  }
  return respond(request, REVIEW_PAGE, outcome);
}

const toNewReview = (input: ReviewInput): NewReview => ({
  name: input.name,
  rating: input.rating,
  service: input.service || null,
  source: input.source || null,
  body: input.body,
});

async function processReview(request: Request, ctx: ReviewContext): Promise<Outcome> {
  const { env } = ctx;
  const url = new URL(request.url);
  const ip = request.headers.get("CF-Connecting-IP");

  // 1. Abuse limit (cheap, before touching the body). The IP is only a limiter key, never stored.
  if (!(await allowReviewRequest(env, `review:${ip ?? "unknown"}`))) {
    return failure("rate_limited", "Too many reviews from here. Please wait a minute and try again.");
  }

  // 2. Size guard + parse
  const body = await readFormDataLimited(request, MAX_REVIEW_BODY_BYTES);
  if (!body.ok) return bodyReadFailure(body.reason, "That review is too long to send.");
  const fd = body.formData;

  // 3. Honeypot: pretend success, store and send nothing
  if (isHoneypotTripped(fd, reviewFields.honeypot)) {
    honeypotTrips += 1;
    console.warn("honeypot tripped", JSON.stringify({ kind: "review", isolateCount: honeypotTrips }));
    return success(SUCCESS_MESSAGE);
  }

  // 4. Reviews need storage and a signing key: never store a review the owner can't moderate.
  const signingKey = signingKeyFrom(env);
  if (!ctx.store || !signingKey) {
    console.error(
      "reviews not configured: the DB binding and a REVIEW_SIGNING_KEY of 32+ characters are required",
    );
    return failure("not_configured", NOT_SET_UP);
  }

  // 5. Turnstile
  const mode = emailMode(env, url.hostname);
  const captcha = await checkCaptcha({
    env,
    mode,
    token: fd.get(reviewFields.turnstile),
    ip,
    hostname: url.hostname,
    action: "review",
  });
  if (captcha) return captcha;

  // 6. Field validation (shared contract)
  const parsed = reviewSchema.safeParse(reviewFormToObject(fd));
  if (!parsed.success) return validationFailure(toFieldErrors(parsed.error));

  let resend: { apiKey: string; to: string } | null = null; // null = log mode
  if (mode === "send") {
    if (!env.RESEND_API_KEY || !env.LEAD_EMAIL_TO) {
      console.error(
        "email not configured: RESEND_API_KEY and LEAD_EMAIL_TO are required when EMAIL_MODE=send",
      );
      return failure("not_configured", NOT_SET_UP);
    }
    resend = { apiKey: env.RESEND_API_KEY, to: env.LEAD_EMAIL_TO };
  }

  // 7. Daily limits, then store as pending (never published until approved). The site-wide cap is only read,
  // so a refused review doesn't use up the visitor's own allowance.
  const now = ctx.now();
  if ((await ctx.store.countCreatedSince(now - DAY_MS)) >= MAX_NEW_REVIEWS_PER_DAY) {
    console.warn("review daily cap reached", JSON.stringify({ cap: MAX_NEW_REVIEWS_PER_DAY }));
    return failure("daily_limit", "We've had a lot of reviews today. Please try again tomorrow.");
  }
  const visitor = { store: ctx.store, waitUntil: ctx.waitUntil };
  if (!(await consumeVisitorAllowance(visitor, signingKey, ip, now))) {
    console.warn("review visitor limit reached", JSON.stringify({ limit: MAX_REVIEWS_PER_VISITOR_PER_DAY }));
    return failure(
      "daily_limit",
      "That's the most reviews we take from one connection in a day. Please try again tomorrow.",
    );
  }
  const review = toNewReview(parsed.data);
  const id = await ctx.store.insertPending(review, now);

  // 8. Moderation email
  const links: ModerationLinks = {
    approve: await createModerationLink(url.origin, signingKey, id, "approve", now),
    remove: await createModerationLink(url.origin, signingKey, id, "delete", now),
  };
  const email = renderModerationEmail(
    { ...review, id, status: "pending", createdAt: now, approvedAt: null },
    links,
  );

  if (!resend) {
    console.log(
      "[review moderation]",
      JSON.stringify({
        mode,
        id,
        subject: email.subject,
        to: env.LEAD_EMAIL_TO ?? null,
        approve: links.approve.url,
        delete: links.remove.url,
      }),
    );
    return success(SUCCESS_MESSAGE);
  }

  const sent = await sendViaResend({
    apiKey: resend.apiKey,
    from: env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM,
    to: resend.to,
    email,
    attachments: [],
  });
  if (!sent) {
    // Without the email nobody can moderate the row, so remove it and let the reviewer retry. The visitor's
    // daily count is deliberately kept: a retry within the allowance still works, and failures can't reset it.
    await ctx.store.remove(id);
    return failure("server", "Your review couldn't be sent right now. Please try again in a moment.", 502);
  }
  return success(SUCCESS_MESSAGE);
}
