/**
 * Moderation (spec §17 step 2): GET /api/reviews/moderate only shows a confirmation page, because email
 * link scanners prefetch GETs; the change happens on the same-origin POST that page's button sends.
 */
import { readFormDataLimited } from "../lib/body";
import { isCrossSite } from "../lib/guards";
import { jsonResponse } from "../lib/http";
import { purgeApproved } from "./cache";
import type { ReviewContext } from "./context";
import { moderationPageResponse, type ModerationPage } from "./moderation-page";
import { parseModerationParams, signingKeyFrom, verifyModeration, type ModerationParams } from "./signing";
import type { ReviewStore, StoredReview } from "./store";

const MAX_MODERATION_BODY_BYTES = 4 * 1024;

const PAGES = {
  notConfigured: {
    status: 503,
    title: "Reviews aren't set up",
    message: "The review database or signing key isn't configured.",
  },
  invalid: {
    status: 403,
    title: "Link not valid",
    message: "This moderation link is incomplete or has been changed. Use the link from the email.",
  },
  expired: { status: 410, title: "Link expired", message: "This moderation link has expired." },
  gone: {
    status: 404,
    title: "Review not found",
    message: "This review doesn't exist anymore. It may already have been deleted.",
  },
  crossSite: {
    status: 403,
    title: "Request blocked",
    message: "Open the link from the email and use the button on that page.",
  },
  error: {
    status: 500,
    title: "Something went wrong",
    message: "Nothing was changed. Please try the link again in a moment.",
  },
} satisfies Record<string, ModerationPage>;

const alreadyPublished = (review: StoredReview): ModerationPage => ({
  status: 200,
  title: "Already published",
  message: "This review is already on the site. Use the Delete link from the email to remove it.",
  review,
});

export async function handleModeration(request: Request, ctx: ReviewContext): Promise<Response> {
  const run =
    request.method === "GET" || request.method === "HEAD"
      ? showConfirmation
      : request.method === "POST"
        ? applyChange
        : null;
  if (!run)
    return jsonResponse({ ok: false, error: "server", message: "Method not allowed." }, 405, {
      Allow: "GET, POST",
    });
  try {
    return moderationPageResponse(await run(request, ctx));
  } catch (err) {
    console.error("review moderation error", err instanceof Error ? err.name : "unknown");
    return moderationPageResponse(PAGES.error);
  }
}

type Verified =
  { ok: true; store: ReviewStore; params: ModerationParams } | { ok: false; page: ModerationPage };

async function verifyLink(ctx: ReviewContext, read: (name: string) => string | null): Promise<Verified> {
  const key = signingKeyFrom(ctx.env);
  if (!key || !ctx.store) {
    console.error(
      "review moderation not configured: the DB binding and a REVIEW_SIGNING_KEY of 32+ characters are required",
    );
    return { ok: false, page: PAGES.notConfigured };
  }
  const params = parseModerationParams(read);
  if (!params) return { ok: false, page: PAGES.invalid };
  const verdict = await verifyModeration(key, params, ctx.now());
  if (verdict !== "ok") return { ok: false, page: verdict === "expired" ? PAGES.expired : PAGES.invalid };
  return { ok: true, store: ctx.store, params };
}

/** GET: read-only. Shows the review and a button that POSTs the signed parameters. */
async function showConfirmation(request: Request, ctx: ReviewContext): Promise<ModerationPage> {
  const query = new URL(request.url).searchParams;
  const link = await verifyLink(ctx, (name) => query.get(name));
  if (!link.ok) return link.page;

  const review = await link.store.findById(link.params.id);
  if (!review) return PAGES.gone;
  if (link.params.action === "approve") {
    if (review.status === "approved") return alreadyPublished(review);
    return {
      status: 200,
      title: "Publish this review?",
      message: "It will appear on the home page and the reviews page.",
      review,
      confirm: { params: link.params, label: "Approve and publish", isDestructive: false },
    };
  }
  return {
    status: 200,
    title: "Delete this review?",
    message:
      review.status === "approved"
        ? "It is currently published. Deleting removes it from the site for good."
        : "It will be removed for good and never published.",
    review,
    confirm: { params: link.params, label: "Delete permanently", isDestructive: true },
  };
}

/** POST: verify again, apply, purge the cached list. Re-sending is harmless (idempotent results). */
async function applyChange(request: Request, ctx: ReviewContext): Promise<ModerationPage> {
  if (isCrossSite(request)) return PAGES.crossSite;
  const body = await readFormDataLimited(request, MAX_MODERATION_BODY_BYTES);
  if (!body.ok) return PAGES.invalid;
  const form = body.formData;
  const link = await verifyLink(ctx, (name) => {
    const value = form.get(name);
    return typeof value === "string" ? value : null;
  });
  if (!link.ok) return link.page;

  const { store, params } = link;
  const origin = new URL(request.url).origin;
  if (params.action === "approve") {
    if (!(await store.approve(params.id, ctx.now()))) {
      const existing = await store.findById(params.id);
      return existing ? alreadyPublished(existing) : PAGES.gone;
    }
    await purgeApproved(ctx, origin);
    const review = (await store.findById(params.id)) ?? undefined;
    return { status: 200, title: "Published", message: "The review is now live on the site.", review };
  }

  if (!(await store.remove(params.id))) return PAGES.gone;
  await purgeApproved(ctx, origin);
  return { status: 200, title: "Deleted", message: "The review has been removed for good." };
}
