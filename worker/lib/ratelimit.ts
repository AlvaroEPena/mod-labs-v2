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

/** Returns true if the request may proceed. Never throws: a limiter failure lets the request through. */
export async function allowRequest(env: Env, key: string): Promise<boolean> {
  if (env.FORM_RATE_LIMITER) {
    try {
      const { success } = await env.FORM_RATE_LIMITER.limit({ key });
      return success;
    } catch (err) {
      console.error("rate limiter binding failed", err instanceof Error ? err.name : "unknown");
      return memoryLimiter.check(key);
    }
  }
  return memoryLimiter.check(key);
}
