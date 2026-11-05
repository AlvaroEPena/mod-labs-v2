/**
 * Publishing (spec §17 step 3): the Worker runs first for the pages that show reviews, fetches the
 * static page and stream-rewrites approved reviews into REVIEW_SLOTS. Reviews are therefore in the
 * HTML (crawlable, no client JS). No reviews, or any failure → the page is served exactly as built.
 */
import { REVIEW_SLOTS } from "../../src/lib/reviews/contract";
import { derivedEtag, etagMatches } from "../lib/etag";
import { loadApproved } from "./cache";
import type { ReviewContext } from "./context";
import type { ReviewsView } from "./view";

/** Must match the page entries of assets.run_worker_first in wrangler.jsonc. */
export const REVIEW_PAGE_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/index.html",
  "/reviews",
  "/reviews.html",
]);

/** Injected HTML can change without the asset changing, so browsers must always revalidate. */
const PAGE_CACHE_CONTROL = "public, max-age=0, must-revalidate";

async function loadView(request: Request, ctx: ReviewContext): Promise<ReviewsView | null> {
  if (!ctx.store) {
    console.warn("reviews: DB binding missing; serving the page without reviews");
    return null;
  }
  try {
    return (await loadApproved(ctx.store, ctx, new URL(request.url).origin)).view;
  } catch (err) {
    console.error(
      "reviews: list unavailable; serving the page without reviews",
      err instanceof Error ? err.name : "unknown",
    );
    return null;
  }
}

function withoutConditionalHeaders(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete("If-None-Match");
  headers.delete("If-Modified-Since");
  return new Request(request.url, { method: request.method, headers });
}

const isHtml = (response: Response) =>
  (response.headers.get("Content-Type") ?? "").toLowerCase().startsWith("text/html");

/** Only renderReviewItem() output is inserted as HTML; the summary is inserted as text (escaped). */
function reviewsRewriter(view: ReviewsView): HTMLRewriter {
  return new HTMLRewriter()
    .on(REVIEW_SLOTS.home, { element: (el) => void el.setInnerContent(view.homeHtml, { html: true }) })
    .on(REVIEW_SLOTS.all, { element: (el) => void el.setInnerContent(view.allHtml, { html: true }) })
    .on(REVIEW_SLOTS.summary, { element: (el) => void el.setInnerContent(view.summary) })
    .on(REVIEW_SLOTS.whenEmpty, { element: (el) => void el.setAttribute("hidden", "") })
    .on(REVIEW_SLOTS.whenAny, { element: (el) => void el.removeAttribute("hidden") });
}

export async function servePageWithReviews(request: Request, ctx: ReviewContext): Promise<Response> {
  const { ASSETS } = ctx.env;
  if (request.method !== "GET" && request.method !== "HEAD") return ASSETS.fetch(request);

  const view = await loadView(request, ctx);
  // Untouched page, including the asset layer's own conditional (304) handling.
  if (!view || view.count === 0) return ASSETS.fetch(request);

  // The browser's validators belong to the rewritten page, not the asset, so don't forward them.
  const asset = await ASSETS.fetch(withoutConditionalHeaders(request));
  if (asset.status !== 200 || !isHtml(asset)) return asset;

  const headers = new Headers(asset.headers);
  headers.delete("Content-Length"); // the rewritten body is streamed with a different length
  headers.set("Cache-Control", PAGE_CACHE_CONTROL);
  const etag = derivedEtag(asset.headers.get("ETag"), view.version);
  if (etag) headers.set("ETag", etag);
  else headers.delete("ETag");

  if (etag && etagMatches(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  return reviewsRewriter(view).transform(new Response(asset.body, { status: 200, headers }));
}
