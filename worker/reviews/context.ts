/** Per-request dependencies of the review routes, injectable for tests. */
import type { Env } from "../lib/env";
import { D1ReviewStore, type ReviewStore } from "./store";

export interface ReviewContext {
  env: Env;
  /** null when the DB binding is missing (reviews then degrade: pages unchanged, API not_configured) */
  store: ReviewStore | null;
  /** caches.default in Workers; null where the Cache API doesn't exist (unit tests) */
  edgeCache: Cache | null;
  /** epoch ms */
  now: () => number;
  waitUntil: (promise: Promise<unknown>) => void;
}

export function createReviewContext(env: Env, ctx: ExecutionContext): ReviewContext {
  return {
    env,
    store: env.DB ? new D1ReviewStore(env.DB) : null,
    edgeCache: typeof caches === "undefined" ? null : caches.default,
    now: () => Date.now(),
    waitUntil: (promise) => ctx.waitUntil(promise),
  };
}
