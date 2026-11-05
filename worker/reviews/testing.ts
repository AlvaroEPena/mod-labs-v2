/** Shared helpers for the review tests (not imported by the Worker). */
import { describe, expect, it, vi } from "vitest";
import { reviewFields } from "../../src/lib/reviews/contract";
import type { Env } from "../lib/env";
import { RESEND_URL, TURNSTILE_VERIFY_URL } from "../lib/integrations";
import type { ReviewContext } from "./context";
import { MemoryReviewStore } from "./memory-store";
import type { NewReview, ReviewStore } from "./store";

export const HOST = "mod-labs.example.workers.dev";
export const ORIGIN = `https://${HOST}`;
export const LOCAL = "http://127.0.0.1:8799";
export const TEST_TURNSTILE_SECRET = "1x0000000000000000000000000000000AA";
export const SIGNING_KEY = "test-only-signing-key-0123456789-abcdefghij";
/** 2026-11-05 12:00 UTC */
export const NOW = Date.UTC(2026, 10, 5, 12);
export const DAY_MS = 86_400_000;

export const sampleReview = (patch: Partial<NewReview> = {}): NewReview => ({
  name: "Jordan M.",
  rating: 5,
  service: "Switch OLED",
  source: "Facebook",
  body: "Dropped off my OLED in the morning and it was done by dinner.",
  ...patch,
});

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response("asset", { status: 200 })) } as unknown as Fetcher,
    TURNSTILE_SECRET_KEY: "real-secret",
    RESEND_API_KEY: "re_test",
    LEAD_EMAIL_TO: "al@example.com",
    EMAIL_MODE: "send",
    REVIEW_SIGNING_KEY: SIGNING_KEY,
    ...overrides,
  };
}

export function makeContext(
  opts: { env?: Env; store?: ReviewStore | null; now?: number; edgeCache?: Cache | null } = {},
): ReviewContext {
  const store = opts.store === undefined ? new MemoryReviewStore() : opts.store;
  return {
    env: opts.env ?? makeEnv(),
    store,
    edgeCache: opts.edgeCache ?? null,
    now: () => opts.now ?? NOW,
    waitUntil: () => {},
  };
}

export const validReviewFields = (): Record<string, string> => ({
  [reviewFields.name]: "Jordan M.",
  [reviewFields.rating]: "5",
  [reviewFields.service]: "Switch OLED",
  [reviewFields.source]: "Facebook",
  [reviewFields.body]: "Dropped off my OLED in the morning and it was done by dinner.",
  [reviewFields.consent]: "yes",
  [reviewFields.honeypot]: "",
  [reviewFields.turnstile]: "XXXX.DUMMY.TOKEN.XXXX",
});

export function reviewForm(patch: Record<string, string> = {}): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...validReviewFields(), ...patch })) fd.append(k, v);
  return fd;
}

let ipCounter = 0;
export interface PostOpts {
  json?: boolean;
  origin?: string;
  headers?: Record<string, string>;
}

/** Serialize a body like a browser does (Content-Type + Content-Length), from a fresh client IP. */
export async function post(
  path: string,
  body: FormData | URLSearchParams,
  opts: PostOpts = {},
): Promise<Request> {
  const origin = opts.origin ?? ORIGIN;
  const encoded = new Response(body);
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  const headers: Record<string, string> = {
    "Content-Type": encoded.headers.get("Content-Type") ?? "",
    "Content-Length": String(bytes.byteLength),
    "CF-Connecting-IP": `198.51.100.${++ipCounter % 250}`,
    Origin: origin,
    ...opts.headers,
  };
  if (opts.json !== false) headers.Accept = "application/json";
  return new Request(`${origin}${path}`, { method: "POST", body: bytes, headers });
}

export interface NetworkMock {
  calls: { url: string; init?: RequestInit }[];
  siteverify: Record<string, unknown>;
  resendStatus: number;
}

/** Stub global fetch: Turnstile siteverify and Resend respond from `state`; anything else throws. */
export function mockNetwork(): NetworkMock {
  const state: NetworkMock = {
    calls: [],
    siteverify: { success: true, hostname: HOST, action: "review" },
    resendStatus: 200,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      state.calls.push({ url, init });
      if (url === TURNSTILE_VERIFY_URL) return Response.json(state.siteverify);
      if (url === RESEND_URL) return Response.json({ id: "email_123" }, { status: state.resendStatus });
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return state;
}

export const resendCalls = (net: NetworkMock) => net.calls.filter((c) => c.url === RESEND_URL);
export const resendPayload = (net: NetworkMock) =>
  JSON.parse(String(resendCalls(net)[0]?.init?.body)) as Record<string, unknown>;

/**
 * Behaviour every ReviewStore must have. Run against MemoryReviewStore (unit) and D1ReviewStore
 * (real D1 + the migration, in runtime.test.ts) so the test double can't drift from production.
 */
export function describeReviewStoreContract(name: string, makeStore: () => Promise<ReviewStore>): void {
  describe(`ReviewStore contract: ${name}`, () => {
    it("inserts pending rows (null optionals) and finds them by id", async () => {
      const store = await makeStore();
      const id = await store.insertPending(sampleReview({ service: null, source: null }), NOW);
      expect(await store.findById(id)).toEqual({
        ...sampleReview({ service: null, source: null }),
        id,
        status: "pending",
        createdAt: NOW,
        approvedAt: null,
      });
      expect(await store.findById(id + 1000)).toBeNull();
    });

    it("lists only approved reviews, newest approval first", async () => {
      const store = await makeStore();
      const a = await store.insertPending(sampleReview({ name: "First" }), NOW);
      const b = await store.insertPending(sampleReview({ name: "Second" }), NOW);
      await store.insertPending(sampleReview({ name: "Pending" }), NOW);
      expect(await store.approve(a, NOW + 1)).toBe(true);
      expect(await store.approve(b, NOW + 2)).toBe(true);
      const listed = await store.listApproved();
      expect(listed.map((r) => r.name)).toEqual(["Second", "First"]);
      expect(listed[0]).toEqual({ id: b, ...sampleReview({ name: "Second" }), approvedAt: NOW + 2 });
      expect(Object.keys(listed[0] ?? {})).not.toContain("status");
    });

    it("approves only pending rows and deletes in any status", async () => {
      const store = await makeStore();
      const id = await store.insertPending(sampleReview(), NOW);
      expect(await store.approve(id, NOW)).toBe(true);
      expect(await store.approve(id, NOW + 5)).toBe(false);
      expect((await store.findById(id))?.approvedAt).toBe(NOW);
      expect(await store.remove(id)).toBe(true);
      expect(await store.remove(id)).toBe(false);
      expect(await store.approve(id, NOW)).toBe(false);
    });

    it("counts rows created since a time", async () => {
      const store = await makeStore();
      await store.insertPending(sampleReview(), NOW - 2 * DAY_MS);
      await store.insertPending(sampleReview(), NOW - 1000);
      await store.insertPending(sampleReview(), NOW);
      expect(await store.countCreatedSince(NOW - DAY_MS)).toBe(2);
    });
  });
}
