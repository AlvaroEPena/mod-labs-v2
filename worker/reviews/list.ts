/** GET /api/reviews: the published list as JSON (approved reviews only, without row ids: see cache.ts). */
import { summarize, type ReviewListResult } from "../../src/lib/reviews/contract";
import { jsonDataResponse, jsonResponse } from "../lib/http";
import { loadApproved, MEMORY_TTL_MS } from "./cache";
import type { ReviewContext } from "./context";

/** Short browser cache; matches how fresh the Worker's own copy is. */
const LIST_CACHE_CONTROL = `public, max-age=${MEMORY_TTL_MS / 1000}`;

export async function handleReviewList(request: Request, ctx: ReviewContext): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse({ ok: false, error: "server", message: "Method not allowed." }, 405, {
      Allow: "GET, HEAD",
    });
  }
  if (!ctx.store) {
    console.error("reviews: DB binding missing");
    return jsonResponse({ ok: false, error: "not_configured", message: "Reviews aren't set up yet." }, 503);
  }
  try {
    const { reviews } = await loadApproved(ctx.store, ctx, new URL(request.url).origin);
    const body: ReviewListResult = { ok: true, reviews, ...summarize(reviews) };
    return jsonDataResponse(body, 200, { "Cache-Control": LIST_CACHE_CONTROL });
  } catch (err) {
    console.error("reviews: list unavailable", err instanceof Error ? err.name : "unknown");
    return jsonResponse(
      { ok: false, error: "server", message: "Reviews couldn't be loaded right now." },
      500,
    );
  }
}
