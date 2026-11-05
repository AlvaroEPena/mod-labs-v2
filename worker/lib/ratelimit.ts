import type { Env } from "./env";

export const RATE_LIMIT = 5;
export const RATE_WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 5_000;

/**
 * Best-effort per-isolate sliding-window limiter, used only when the FORM_RATE_LIMITER
 * binding is not configured. Isolates are short-lived and not shared, so this is a
 * speed bump, not a guarantee.
 */
export class MemoryRateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private limit = RATE_LIMIT,
    private windowMs = RATE_WINDOW_MS,
  ) {}

  check(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.delete(key); // re-insert to keep Map order ≈ LRU
    this.hits.set(key, recent);
    if (this.hits.size > MAX_TRACKED_KEYS) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    return true;
  }

  reset(): void {
    this.hits.clear();
  }
}

export const memoryLimiter = new MemoryRateLimiter();

/**
 * Reviews: 2 per 60 s per IP. Must match REVIEW_RATE_LIMITER in wrangler.jsonc. The binding only
 * supports 10 s or 60 s periods, so longer-term abuse is bounded by the daily cap in reviews/submit.ts.
 */
export const REVIEW_RATE_LIMIT = 2;
export const REVIEW_RATE_WINDOW_MS = 60_000;
export const reviewMemoryLimiter = new MemoryRateLimiter(REVIEW_RATE_LIMIT, REVIEW_RATE_WINDOW_MS);

/** Binding when configured, in-memory fallback otherwise. Never throws: a binding failure falls back. */
async function allowWith(
  binding: RateLimit | undefined,
  fallback: MemoryRateLimiter,
  key: string,
): Promise<boolean> {
  if (binding) {
    try {
      const { success } = await binding.limit({ key });
      return success;
    } catch (err) {
      console.error("rate limiter binding failed", err instanceof Error ? err.name : "unknown");
      return fallback.check(key);
    }
  }
  return fallback.check(key);
}

/** Book/quote forms. Returns true if the request may proceed. */
export const allowRequest = (env: Env, key: string): Promise<boolean> =>
  allowWith(env.FORM_RATE_LIMITER, memoryLimiter, key);

/** Review submissions. Returns true if the request may proceed. */
export const allowReviewRequest = (env: Env, key: string): Promise<boolean> =>
  allowWith(env.REVIEW_RATE_LIMITER, reviewMemoryLimiter, key);
