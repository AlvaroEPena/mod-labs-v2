/**
 * Approved-review list cache, two tiers:
 *  1. per isolate (MEMORY_TTL_MS): absorbs bursts with no I/O at all;
 *  2. per Cloudflare location via the Cache API (EDGE_TTL_SECONDS): spares D1 round trips.
 * Moderation purges both in the isolate/location that handled it; elsewhere a change shows up within
 * EDGE_TTL_SECONDS + MEMORY_TTL_MS. (The Cache API is a no-op on *.workers.dev, so there it's tier 1 + D1.)
 * In-flight loads are deliberately not shared between requests: Workers forbid sharing I/O across requests.
 */
import type { PublicReview } from "../../src/lib/reviews/contract";
import type { ReviewContext } from "./context";
import type { ReviewStore } from "./store";
import { buildReviewsView, type ReviewsView } from "./view";

export const MEMORY_TTL_MS = 10_000;
export const EDGE_TTL_SECONDS = 60;
/** Synthetic same-zone key; never served (the Worker owns every request before the cache). */
const EDGE_KEY_PATH = "/__reviews-cache/approved-v1";

export interface ApprovedSnapshot {
  reviews: PublicReview[];
  view: ReviewsView;
}

type CacheDeps = Pick<ReviewContext, "edgeCache" | "now" | "waitUntil">;

let memo: { snapshot: ApprovedSnapshot; expiresAt: number } | null = null;
/** Bumped by every purge, so a load that started before it can't re-cache the old list. */
let generation = 0;

const edgeKey = (origin: string) => new Request(new URL(EDGE_KEY_PATH, origin).toString());
const errorName = (err: unknown) => (err instanceof Error ? err.name : "unknown");

async function readEdge(edge: Cache, origin: string): Promise<PublicReview[] | null> {
  try {
    const hit = await edge.match(edgeKey(origin));
    if (!hit) return null;
    const data: unknown = await hit.json();
    return Array.isArray(data) ? (data as PublicReview[]) : null;
  } catch (err) {
    console.warn("reviews edge cache read failed", errorName(err));
    return null;
  }
}

function writeEdge(deps: CacheDeps & { edgeCache: Cache }, origin: string, reviews: PublicReview[]): void {
  const response = new Response(JSON.stringify(reviews), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${EDGE_TTL_SECONDS}` },
  });
  deps.waitUntil(
    deps.edgeCache
      .put(edgeKey(origin), response)
      .catch((err) => console.warn("reviews edge cache write failed", errorName(err))),
  );
}

/** The approved list plus its rendered view. Throws when D1 fails (callers decide how to degrade). */
export async function loadApproved(
  store: ReviewStore,
  deps: CacheDeps,
  origin: string,
): Promise<ApprovedSnapshot> {
  if (memo && memo.expiresAt > deps.now()) return memo.snapshot;
  const startedIn = generation;

  let reviews = deps.edgeCache ? await readEdge(deps.edgeCache, origin) : null;
  if (!reviews) {
    reviews = await store.listApproved();
    if (deps.edgeCache && startedIn === generation)
      writeEdge({ ...deps, edgeCache: deps.edgeCache }, origin, reviews);
  }

  const snapshot = { reviews, view: await buildReviewsView(reviews) };
  if (startedIn === generation) memo = { snapshot, expiresAt: deps.now() + MEMORY_TTL_MS };
  return snapshot;
}

/** Drop both tiers after a moderation change. Never throws. */
export async function purgeApproved(deps: Pick<CacheDeps, "edgeCache">, origin: string): Promise<void> {
  generation += 1;
  memo = null;
  if (!deps.edgeCache) return;
  try {
    await deps.edgeCache.delete(edgeKey(origin));
  } catch (err) {
    console.warn("reviews edge cache purge failed", errorName(err));
  }
}

/** Tests: forget the per-isolate copy. */
export function resetApprovedCache(): void {
  generation += 1;
  memo = null;
}
