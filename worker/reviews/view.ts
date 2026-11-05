/** What the page rewriter injects, rendered once per cache fill rather than per request. */
import {
  HOME_REVIEW_LIMIT,
  renderReviewItem,
  summarize,
  summaryText,
  type PublicReview,
} from "../../src/lib/reviews/contract";

export interface ReviewsView {
  count: number;
  /** renderReviewItem() markup for REVIEW_SLOTS.home (latest HOME_REVIEW_LIMIT) */
  homeHtml: string;
  /** renderReviewItem() markup for REVIEW_SLOTS.all (every approved review) */
  allHtml: string;
  /** plain text for REVIEW_SLOTS.summary */
  summary: string;
  /** short hash of everything injected; part of the page ETag */
  version: string;
}

async function shortHash(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `reviews` must already be newest first (ReviewStore.listApproved order). */
export async function buildReviewsView(reviews: readonly PublicReview[]): Promise<ReviewsView> {
  const items = reviews.map(renderReviewItem);
  const homeHtml = items.slice(0, HOME_REVIEW_LIMIT).join("");
  const allHtml = items.join("");
  const summary = summaryText(summarize(reviews));
  // homeHtml is a prefix of allHtml, so hashing allHtml + summary covers every injected byte.
  return {
    count: reviews.length,
    homeHtml,
    allHtml,
    summary,
    version: await shortHash(`${allHtml}\u0000${summary}`),
  };
}
