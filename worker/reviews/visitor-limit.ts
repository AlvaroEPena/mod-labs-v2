/**
 * Per-visitor daily review limit (spec §18): MAX_REVIEWS_PER_VISITOR_PER_DAY per UTC day per IPv4 address
 * or IPv6 /64 (worker/lib/ip.ts). The address is never stored. Each D1 row (`review_limits`) holds only
 *   dayKey = HMAC-SHA256(REVIEW_SIGNING_KEY, "review-limit:" + yyyy-mm-dd)
 *   key    = HMAC-SHA256(dayKey, bucket)
 * so without the signing key the table can't be reversed to addresses, and buckets can't be linked across days.
 * Only today's and yesterday's rows are kept.
 */
import { ipBucket } from "../lib/ip";
import type { ReviewContext } from "./context";
import type { ReviewStore } from "./store";

export const MAX_REVIEWS_PER_VISITOR_PER_DAY = 3;
/**
 * Shared bucket for a missing or malformed CF-Connecting-IP. Cloudflare always sets a valid one, so this
 * only matters outside it; sharing one bucket means bad input can't be used to skip the limit.
 */
export const UNKNOWN_VISITOR_BUCKET = "unknown";
const DAY_MS = 86_400_000;

const encoder = new TextEncoder();

/** "2026-11-05" for any time on that UTC day. */
export const utcDay = (epochMs: number): string => new Date(epochMs).toISOString().slice(0, 10);

async function hmacSha256(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
}

const toHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

/** The stored key for one visitor bucket on one UTC day (64 hex characters). */
export async function visitorBucketKey(signingKey: string, day: string, bucket: string): Promise<string> {
  const dayKey = await hmacSha256(encoder.encode(signingKey), `review-limit:${day}`);
  return toHex(await hmacSha256(dayKey, bucket));
}

export type VisitorLimitDeps = Pick<ReviewContext, "waitUntil"> & { store: ReviewStore };

/**
 * Counts this submission against the visitor's allowance for the current UTC day. Returns false once the
 * allowance is used up. Call it only for submissions that will otherwise be stored, so a typo or a failed
 * spam check doesn't use up the allowance.
 */
export async function consumeVisitorAllowance(
  deps: VisitorLimitDeps,
  signingKey: string,
  clientIp: string | null,
  nowMs: number,
): Promise<boolean> {
  const day = utcDay(nowMs);
  const bucket = ipBucket(clientIp);
  if (!bucket) console.warn("review limit: no usable client IP; counting it in the shared bucket");
  const key = await visitorBucketKey(signingKey, day, bucket ?? UNKNOWN_VISITOR_BUCKET);
  const count = await deps.store.recordVisitorSubmission(key, day);

  // Housekeeping off the response path: keep only today's and yesterday's buckets.
  deps.waitUntil(
    deps.store
      .purgeVisitorCountsBefore(utcDay(nowMs - DAY_MS))
      .catch((err) => console.warn("review limit purge failed", err instanceof Error ? err.name : "unknown")),
  );
  return count <= MAX_REVIEWS_PER_VISITOR_PER_DAY;
}
