// Worker entry. Runs first (assets.run_worker_first) for /api/* and for the pages that show reviews;
// everything else is served from static assets without invoking the Worker.
import { handleApi } from "./handler";
import type { Env } from "./lib/env";
import { createReviewContext, type ReviewContext } from "./reviews/context";
import { handleReviewList } from "./reviews/list";
import { handleModeration } from "./reviews/moderate";
import { REVIEW_PAGE_PATHS, servePageWithReviews } from "./reviews/publish";
import { MODERATE_PATH } from "./reviews/signing";
import { handleReviewSubmit } from "./reviews/submit";

export type { Env } from "./lib/env";

const REVIEW_API: Record<string, (request: Request, ctx: ReviewContext) => Promise<Response>> = {
  "/api/review": handleReviewSubmit,
  "/api/reviews": handleReviewList,
  [MODERATE_PATH]: handleModeration,
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    const reviewRoute = Object.hasOwn(REVIEW_API, pathname) ? REVIEW_API[pathname] : undefined;
    if (reviewRoute) return reviewRoute(request, createReviewContext(env, ctx));
    if (pathname === "/api" || pathname.startsWith("/api/")) return handleApi(request, env);
    if (REVIEW_PAGE_PATHS.has(pathname)) return servePageWithReviews(request, createReviewContext(env, ctx));
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
