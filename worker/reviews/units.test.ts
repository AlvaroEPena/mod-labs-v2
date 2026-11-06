import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import entry from "../index";
import { renderReviewItem, type PublicReview, type ReviewListResult } from "../../src/lib/reviews/contract";
import { derivedEtag, etagMatches } from "../lib/etag";
import { EDGE_TTL_SECONDS, loadApproved, MEMORY_TTL_MS, purgeApproved, resetApprovedCache } from "./cache";
import type { ReviewContext } from "./context";
import { handleReviewList } from "./list";
import { MemoryReviewStore } from "./memory-store";
import { renderModerationEmail } from "./moderation-email";
import { servePageWithReviews } from "./publish";
import { createModerationLink, parseModerationParams, signingKeyFrom, verifyModeration } from "./signing";
import {
  describeReviewStoreContract,
  makeContext,
  makeEnv,
  NOW,
  ORIGIN,
  sampleReview,
  SIGNING_KEY,
} from "./testing";
import { buildReviewsView } from "./view";

beforeEach(() => {
  resetApprovedCache();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const published = (id: number, patch: Partial<PublicReview> = {}): PublicReview => ({
  id,
  ...sampleReview({ name: `Reviewer ${id}` }),
  approvedAt: NOW - id * 1000,
  ...patch,
});

describeReviewStoreContract("MemoryReviewStore", async () => new MemoryReviewStore());

describe("signing", () => {
  it("requires a signing key of at least 32 characters", () => {
    expect(signingKeyFrom(makeEnv())).toBe(SIGNING_KEY);
    expect(signingKeyFrom(makeEnv({ REVIEW_SIGNING_KEY: "  " }))).toBeNull();
    expect(signingKeyFrom(makeEnv({ REVIEW_SIGNING_KEY: "x".repeat(31) }))).toBeNull();
  });

  it("round-trips a link and rejects it after expiry", async () => {
    const url = new URL((await createModerationLink(ORIGIN, SIGNING_KEY, 7, "approve", NOW)).url);
    const params = parseModerationParams((k) => url.searchParams.get(k));
    expect(params).toMatchObject({ id: 7, action: "approve" });
    expect(params && (await verifyModeration(SIGNING_KEY, params, NOW))).toBe("ok");
    expect(params && (await verifyModeration(SIGNING_KEY, params, NOW + 31 * 86_400_000))).toBe("expired");
  });

  it.each([
    { id: "01" },
    { id: "1.5" },
    { id: "-1" },
    { id: "1".repeat(16) },
    { exp: "12ab" },
    { exp: "0" },
    { action: "Approve" },
    { sig: "short" },
    { sig: "x".repeat(42) + "=" },
  ])("parses strictly: rejects %o", (patch) => {
    const values: Record<string, string> = {
      id: "3",
      action: "delete",
      exp: "1800000000",
      sig: "A".repeat(43),
      ...patch,
    };
    expect(parseModerationParams((k) => values[k] ?? null)).toBeNull();
  });
});

describe("etag helpers", () => {
  it("derives a weak tag from the asset tag and the content version", () => {
    expect(derivedEtag('"abc"', "v1")).toBe('W/"abc.v1"');
    expect(derivedEtag('W/"abc"', "v1")).toBe('W/"abc.v1"');
    expect(derivedEtag(null, "v1")).toBeNull();
  });
  it("matches If-None-Match with weak comparison, lists and *", () => {
    expect(etagMatches('W/"abc.v1"', 'W/"abc.v1"')).toBe(true);
    expect(etagMatches('"abc.v1"', 'W/"abc.v1"')).toBe(true);
    expect(etagMatches('"x", W/"abc.v1"', 'W/"abc.v1"')).toBe(true);
    expect(etagMatches("*", 'W/"abc.v1"')).toBe(true);
    expect(etagMatches('"abc"', 'W/"abc.v1"')).toBe(false);
    expect(etagMatches(null, 'W/"abc.v1"')).toBe(false);
  });
});

describe("buildReviewsView", () => {
  it("renders the home slice, the full list and the summary via the contract", async () => {
    const reviews = [1, 2, 3, 4].map((id) => published(id, { rating: id === 4 ? 4 : 5 }));
    const view = await buildReviewsView(reviews);
    expect(view.count).toBe(4);
    expect(view.homeHtml).toBe(reviews.slice(0, 3).map(renderReviewItem).join(""));
    expect(view.allHtml).toBe(reviews.map(renderReviewItem).join(""));
    expect(view.summary).toBe("4.8 average from 4 reviews");
    expect(view.version).toMatch(/^[0-9a-f]{16}$/);
  });
  it("escapes review text and changes version when the content changes", async () => {
    const a = await buildReviewsView([
      published(1, { body: "<script>alert(1)</script> nice work on the console" }),
    ]);
    expect(a.allHtml).not.toContain("<script>");
    expect(a.allHtml).toContain("&lt;script&gt;");
    const b = await buildReviewsView([published(1)]);
    expect(b.version).not.toBe(a.version);
    expect((await buildReviewsView([published(1)])).version).toBe(b.version);
  });
});

/** Minimal Cache API stand-in keyed by URL. */
class FakeCache {
  entries = new Map<string, string>();
  async match(req: Request) {
    const body = this.entries.get(req.url);
    return body === undefined ? undefined : new Response(body);
  }
  async put(req: Request, res: Response) {
    expect(res.headers.get("Cache-Control")).toBe(`public, max-age=${EDGE_TTL_SECONDS}`);
    this.entries.set(req.url, await res.text());
  }
  async delete(req: Request) {
    return this.entries.delete(req.url);
  }
}

describe("approved list cache", () => {
  it("serves from memory within the TTL, reloads after it, and reloads after a purge", async () => {
    const store = new MemoryReviewStore();
    store.seed({ ...sampleReview(), status: "approved", createdAt: NOW, approvedAt: NOW });
    const spy = vi.spyOn(store, "listApproved");
    let now = NOW;
    const deps = { edgeCache: null, now: () => now, waitUntil: () => {} };
    await loadApproved(store, deps, ORIGIN);
    await loadApproved(store, deps, ORIGIN);
    expect(spy).toHaveBeenCalledTimes(1);
    now += MEMORY_TTL_MS + 1;
    await loadApproved(store, deps, ORIGIN);
    expect(spy).toHaveBeenCalledTimes(2);
    await purgeApproved(deps, ORIGIN);
    await loadApproved(store, deps, ORIGIN);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("fills and reads the edge cache, and purges it on moderation", async () => {
    const store = new MemoryReviewStore();
    store.seed({ ...sampleReview(), status: "approved", createdAt: NOW, approvedAt: NOW });
    const edge = new FakeCache();
    const pendingWrites: Promise<unknown>[] = [];
    const deps = {
      edgeCache: edge as unknown as Cache,
      now: () => NOW,
      waitUntil: (p: Promise<unknown>) => void pendingWrites.push(p),
    };
    const first = await loadApproved(store, deps, ORIGIN);
    await Promise.all(pendingWrites);
    expect(edge.entries.size).toBe(1);
    const [cachedJson = ""] = edge.entries.values();
    expect(JSON.parse(cachedJson)).toEqual([expect.not.objectContaining({ id: expect.anything() })]);
    expect(cachedJson).not.toContain('"id"');

    resetApprovedCache(); // a different isolate in the same location
    const spy = vi.spyOn(store, "listApproved");
    expect((await loadApproved(store, deps, ORIGIN)).reviews).toEqual(first.reviews);
    expect(spy).not.toHaveBeenCalled();

    await purgeApproved(deps, ORIGIN);
    expect(edge.entries.size).toBe(0);
  });

  it("drops ids even from an edge entry that still has them", async () => {
    const edge = new FakeCache();
    const withId = [{ ...published(9), extra: "x" }];
    edge.entries.set(`${ORIGIN}/__reviews-cache/approved-v2`, JSON.stringify(withId));
    const deps = { edgeCache: edge as unknown as Cache, now: () => NOW, waitUntil: () => {} };
    const { reviews } = await loadApproved(new MemoryReviewStore(), deps, ORIGIN);
    expect(reviews).toEqual([{ ...sampleReview({ name: "Reviewer 9" }), approvedAt: NOW - 9000 }]);
  });

  it("propagates store failures (callers degrade)", async () => {
    const store = new MemoryReviewStore();
    store.failWith = new Error("boom");
    await expect(
      loadApproved(store, { edgeCache: null, now: () => NOW, waitUntil: () => {} }, ORIGIN),
    ).rejects.toThrow("boom");
  });
});

describe("GET /api/reviews", () => {
  it("returns approved reviews only, without row ids, with count and average and a short cache", async () => {
    const store = new MemoryReviewStore();
    store.seed({
      ...sampleReview({ name: "Older", rating: 4 }),
      status: "approved",
      createdAt: NOW,
      approvedAt: NOW - 5,
    });
    store.seed({
      ...sampleReview({ name: "Newer", rating: 5 }),
      status: "approved",
      createdAt: NOW,
      approvedAt: NOW,
    });
    store.seed({ ...sampleReview({ name: "Hidden" }), createdAt: NOW });
    const res = await handleReviewList(new Request(`${ORIGIN}/api/reviews`), makeContext({ store }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=10");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const text = await res.text();
    expect(text).not.toContain('"id"');
    const body = JSON.parse(text) as ReviewListResult;
    expect(body).toEqual({ ok: true, reviews: expect.any(Array), count: 2, average: 4.5 });
    expect(body.reviews.map((r) => r.name)).toEqual(["Newer", "Older"]);
    expect(Object.keys(body.reviews[0] ?? {}).sort()).toEqual([
      "approvedAt",
      "body",
      "name",
      "rating",
      "service",
      "source",
    ]);
  });

  it("returns an empty list with a null average", async () => {
    const res = await handleReviewList(new Request(`${ORIGIN}/api/reviews`), makeContext());
    expect(await res.json()).toEqual({ ok: true, reviews: [], count: 0, average: null });
  });

  it("degrades with JSON errors and rejects writes", async () => {
    expect(
      (await handleReviewList(new Request(`${ORIGIN}/api/reviews`), makeContext({ store: null }))).status,
    ).toBe(503);
    const failing = new MemoryReviewStore();
    failing.failWith = new Error("D1 down");
    const res = await handleReviewList(new Request(`${ORIGIN}/api/reviews`), makeContext({ store: failing }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, error: "server" });
    expect(
      (await handleReviewList(new Request(`${ORIGIN}/api/reviews`, { method: "POST" }), makeContext()))
        .status,
    ).toBe(405);
  });
});

describe("servePageWithReviews fallbacks (the HTMLRewriter path runs in runtime.test.ts)", () => {
  const ASSET_ETAG = '"asset"';
  const PAGE_HEADERS = {
    "Content-Type": "text/html; charset=utf-8",
    ETag: ASSET_ETAG,
    "Content-Security-Policy": "script-src 'self' 'sha256-abc='",
  };
  /** Like the asset layer: the built page with its _headers headers (validators are never forwarded). */
  const htmlAssets = () =>
    makeEnv({
      ASSETS: {
        fetch: vi.fn(async () => new Response("<p>asset</p>", { headers: PAGE_HEADERS })),
      } as unknown as Fetcher,
    });
  const failingStore = () => {
    const store = new MemoryReviewStore();
    store.failWith = new Error("D1 down");
    return store;
  };
  const forwarded = (ctx: ReviewContext) => vi.mocked(ctx.env.ASSETS.fetch).mock.calls[0]?.[0] as Request;

  it.each([
    ["no reviews", () => makeContext({ env: htmlAssets() })],
    ["no DB binding", () => makeContext({ env: htmlAssets(), store: null })],
    ["a database error", () => makeContext({ env: htmlAssets(), store: failingStore() })],
  ])(
    "serves the page exactly as built with %s, and answers its validators itself",
    async (_label, makeCtx) => {
      const ctx = makeCtx();
      const page = await servePageWithReviews(new Request(`${ORIGIN}/`), ctx);
      expect(page.status).toBe(200);
      expect(await page.text()).toBe("<p>asset</p>");
      expect(Object.fromEntries(page.headers)).toMatchObject({
        etag: ASSET_ETAG,
        "content-security-policy": PAGE_HEADERS["Content-Security-Policy"],
      });

      const conditional = new Request(`${ORIGIN}/`, { headers: { "If-None-Match": ASSET_ETAG } });
      const notModified = await servePageWithReviews(conditional, makeCtx());
      expect(notModified.status).toBe(304);
      expect(await notModified.text()).toBe("");
      expect(notModified.headers.get("ETag")).toBe(ASSET_ETAG);
      expect(notModified.headers.get("Content-Security-Policy")).toBe(
        PAGE_HEADERS["Content-Security-Policy"],
      );
    },
  );

  it("never forwards the browser's validators to the asset layer", async () => {
    const ctx = makeContext({ env: htmlAssets() });
    const conditional = new Request(`${ORIGIN}/`, {
      headers: { "If-None-Match": ASSET_ETAG, "If-Modified-Since": "Wed, 04 Nov 2026 00:00:00 GMT" },
    });
    await servePageWithReviews(conditional, ctx);
    expect(forwarded(ctx).headers.get("If-None-Match")).toBeNull();
    expect(forwarded(ctx).headers.get("If-Modified-Since")).toBeNull();
  });

  it("fetches the page while the reviews are still loading (L9)", async () => {
    const store = new MemoryReviewStore();
    let releaseReviews: (rows: PublicReview[]) => void = () => {};
    vi.spyOn(store, "listApproved").mockReturnValue(new Promise((resolve) => (releaseReviews = resolve)));
    const ctx = makeContext({ env: htmlAssets(), store });
    const serving = servePageWithReviews(new Request(`${ORIGIN}/`), ctx);
    await vi.waitFor(() => expect(ctx.env.ASSETS.fetch).toHaveBeenCalledOnce());
    releaseReviews([]);
    expect(await (await serving).text()).toBe("<p>asset</p>");
  });

  it("passes non-HTML or non-200 asset responses through untouched", async () => {
    const ctx = makeContext(); // makeEnv's stub answers text/plain
    expect(await (await servePageWithReviews(new Request(`${ORIGIN}/`), ctx)).text()).toBe("asset");
  });

  it("doesn't touch non-GET/HEAD requests", async () => {
    const ctx = makeContext();
    const post = new Request(`${ORIGIN}/`, { method: "POST" });
    await servePageWithReviews(post, ctx);
    expect(ctx.env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(forwarded(ctx)).toBe(post);
  });
});

describe("Worker routing", () => {
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

  it("routes the review API (no DB binding → not_configured) and still 404s unknown API paths", async () => {
    const env = makeEnv();
    expect((await entry.fetch(new Request(`${ORIGIN}/api/reviews`), env, ctx)).status).toBe(503);
    expect((await entry.fetch(new Request(`${ORIGIN}/api/review`), env, ctx)).status).toBe(405);
    expect((await entry.fetch(new Request(`${ORIGIN}/api/reviews/moderate`), env, ctx)).status).toBe(503);
    expect(
      (await entry.fetch(new Request(`${ORIGIN}/api/reviews/nope`, { method: "POST" }), env, ctx)).status,
    ).toBe(404);
    expect(
      (await entry.fetch(new Request(`${ORIGIN}/api/toString`, { method: "POST" }), env, ctx)).status,
    ).toBe(404);
  });

  it("serves review pages untouched without a DB, and other pages straight from assets", async () => {
    const env = makeEnv();
    for (const path of ["/", "/reviews", "/gallery"]) {
      expect(await (await entry.fetch(new Request(`${ORIGIN}${path}`), env, ctx)).text()).toBe("asset");
    }
  });
});

describe("moderation email", () => {
  it("escapes every field, has no reply-to and carries both links", async () => {
    const approve = await createModerationLink(ORIGIN, SIGNING_KEY, 3, "approve", NOW);
    const remove = await createModerationLink(ORIGIN, SIGNING_KEY, 3, "delete", NOW);
    const email = renderModerationEmail(
      {
        ...sampleReview({ name: "A\r\nBcc: x@y.z", body: `"><b>bold</b>`, source: "Other" }),
        id: 3,
        status: "pending",
        createdAt: NOW,
        approvedAt: null,
      },
      { approve, remove },
    );
    expect(email.replyTo).toBeUndefined();
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.html).not.toContain("<b>bold</b>");
    expect(email.html).toContain("&quot;&gt;&lt;b&gt;bold&lt;/b&gt;");
    expect(email.html).toContain(`href="${approve.url.replace(/&/g, "&amp;")}"`);
    expect(email.text).toContain(`Delete: ${remove.url}`);
    expect(email.text).toContain("Heard about us: Other");
    expect(email.text).toContain("valid until 2026-12-05");
  });
});
