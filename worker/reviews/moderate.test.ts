import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadApproved, resetApprovedCache } from "./cache";
import type { ReviewContext } from "./context";
import { MemoryReviewStore } from "./memory-store";
import { handleModeration } from "./moderate";
import {
  createModerationLink,
  LINK_LIFETIME_SECONDS,
  MODERATE_PATH,
  signModeration,
  type ModerationAction,
} from "./signing";
import { DAY_MS, makeContext, makeEnv, NOW, ORIGIN, post, sampleReview, SIGNING_KEY } from "./testing";

let store: MemoryReviewStore;
let ctx: ReviewContext;

beforeEach(() => {
  resetApprovedCache();
  store = new MemoryReviewStore();
  ctx = makeContext({ store });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

const pending = (patch = {}) => store.seed({ ...sampleReview(patch), createdAt: NOW - 1000 });
const approved = () =>
  store.seed({
    ...sampleReview({ name: "Pat" }),
    status: "approved",
    createdAt: NOW - 2 * DAY_MS,
    approvedAt: NOW - DAY_MS,
  });

const link = async (id: number, action: ModerationAction, signedAt = NOW) =>
  new URL((await createModerationLink(ORIGIN, SIGNING_KEY, id, action, signedAt)).url);

const open = (url: URL, at: ReviewContext = ctx) => handleModeration(new Request(url), at);

/** Press the confirmation button: POST the link's parameters as a same-origin form. */
const confirm = async (url: URL, opts: Parameters<typeof post>[2] = {}, at: ReviewContext = ctx) =>
  handleModeration(
    await post(MODERATE_PATH, new URLSearchParams(url.searchParams), { json: false, ...opts }),
    at,
  );

const withParam = (url: URL, name: string, value: string) => {
  const copy = new URL(url);
  copy.searchParams.set(name, value);
  return copy;
};

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const sigOf = (u: URL) => u.searchParams.get("sig") ?? "";
/** Change the first character: different MAC bytes. */
const flippedSig = (u: URL) =>
  withParam(u, "sig", (sigOf(u).startsWith("A") ? "B" : "A") + sigOf(u).slice(1));
/** Same MAC bytes, different spelling: the last character's two unused low bits set. */
const nonCanonicalSig = (u: URL) =>
  withParam(u, "sig", sigOf(u).slice(0, -1) + B64URL[B64URL.indexOf(sigOf(u).slice(-1)) + 1]);

describe("GET /api/reviews/moderate (confirmation page)", () => {
  it("shows the escaped review and a POST form with the signed parameters", async () => {
    const review = pending({
      name: "Sam O'Neil",
      body: `<img src=x onerror=alert(1)> fixed my drift, recommended`,
    });
    const url = await link(review.id, "approve");
    const res = await open(url);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Publish this review?");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain("Sam O&#39;Neil");
    expect(html).toContain(`<form method="post" action="${MODERATE_PATH}">`);
    for (const name of ["id", "action", "exp", "sig"]) {
      expect(html).toContain(`name="${name}" value="${url.searchParams.get(name)}"`);
    }
    expect(html).toContain(">Approve and publish</button>");
  });

  it("never changes anything, for either action", async () => {
    const a = pending();
    const b = approved();
    const before = store.all();
    for (const url of [await link(a.id, "approve"), await link(a.id, "delete"), await link(b.id, "delete")]) {
      expect((await open(url)).status).toBe(200);
      expect((await handleModeration(new Request(url, { method: "HEAD" }), ctx)).status).toBe(200);
    }
    expect(store.all()).toEqual(before);
  });

  it("sends a strict CSP (nonce'd styles, form-action 'self') and no-store/noindex headers", async () => {
    const res = await open(await link(pending().id, "delete"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(await res.text()).toContain(`<style nonce="${nonce}">`);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    // no-referrer would make browsers send `Origin: null` on the confirm POST
    expect(res.headers.get("Referrer-Policy")).toBe("same-origin");
  });

  it("says when a review is already published or gone", async () => {
    const live = approved();
    expect(await (await open(await link(live.id, "approve"))).text()).toContain("Already published");
    const gone = await open(await link(999, "delete"));
    expect(gone.status).toBe(404);
  });
});

describe("POST /api/reviews/moderate", () => {
  it("approves with a valid signature, then the published list shows it", async () => {
    const review = pending();
    expect((await loadApproved(store, ctx, ORIGIN)).reviews).toHaveLength(0); // primes the cache
    const res = await confirm(await link(review.id, "approve"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Published");
    expect(await store.findById(review.id)).toMatchObject({ status: "approved", approvedAt: NOW });
    expect((await loadApproved(store, ctx, ORIGIN)).reviews.map((r) => r.name)).toEqual([review.name]); // purged
  });

  it("is idempotent: approving twice reports Already published", async () => {
    const url = await link(pending().id, "approve");
    await confirm(url);
    const again = await confirm(url);
    expect(again.status).toBe(200);
    expect(await again.text()).toContain("Already published");
  });

  it("deletes an approved review (and purges the list); a repeat reports it gone", async () => {
    const live = approved();
    expect((await loadApproved(store, ctx, ORIGIN)).reviews).toHaveLength(1);
    const url = await link(live.id, "delete");
    const res = await confirm(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Deleted");
    expect(await store.findById(live.id)).toBeNull();
    expect((await loadApproved(store, ctx, ORIGIN)).reviews).toHaveLength(0);
    expect((await confirm(url)).status).toBe(404);
  });

  it("never lets an old link act on a later review that came after the newest one was deleted (M1)", async () => {
    const deleted = pending({ name: "Deleted Newest" });
    const staleApprove = await link(deleted.id, "approve");
    const staleDelete = await link(deleted.id, "delete");
    expect((await confirm(staleDelete)).status).toBe(200);
    const next = pending({ name: "Next Reviewer" });
    expect(next.id).toBeGreaterThan(deleted.id);
    expect((await confirm(staleApprove)).status).toBe(404);
    expect((await confirm(staleDelete)).status).toBe(404);
    expect(await store.findById(next.id)).toMatchObject({ name: "Next Reviewer", status: "pending" });
  });

  it("keeps delete links working for a year and approve links for 30 days", async () => {
    const review = pending();
    const later = makeContext({ store, now: NOW + 200 * DAY_MS });
    expect((await confirm(await link(review.id, "approve"), {}, later)).status).toBe(410);
    expect((await confirm(await link(review.id, "delete"), {}, later)).status).toBe(200);
  });

  it.each([
    ["a tampered signature", flippedSig],
    ["a non-canonical signature", nonCanonicalSig],
    ["a different id", (u: URL) => withParam(u, "id", String(Number(u.searchParams.get("id")) + 1))],
    ["a wrong action (approve signature, delete action)", (u: URL) => withParam(u, "action", "delete")],
    ["a moved expiry", (u: URL) => withParam(u, "exp", String(Number(u.searchParams.get("exp")) + 1))],
    ["a missing signature", (u: URL) => withParam(u, "sig", "")],
    ["an unknown action", (u: URL) => withParam(u, "action", "publish")],
  ])("rejects %s (403) and changes nothing", async (_label, tamper) => {
    pending({ name: "Other" });
    const review = pending();
    const before = store.all();
    const url = tamper(await link(review.id, "approve"));
    const res = await confirm(url);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Link not valid");
    expect((await open(url)).status).toBe(403);
    expect(store.all()).toEqual(before);
  });

  it("rejects expired links (410)", async () => {
    const review = pending();
    const url = await link(review.id, "approve", NOW - 31 * DAY_MS);
    expect((await confirm(url)).status).toBe(410);
    expect((await open(url)).status).toBe(410);
    expect((await store.findById(review.id))?.status).toBe("pending");
  });

  it("rejects a correctly signed link that outlives the lifetime policy", async () => {
    const review = pending();
    const exp = Math.floor(NOW / 1000) + LINK_LIFETIME_SECONDS.approve + 86_400;
    const url = new URL(`${ORIGIN}${MODERATE_PATH}`);
    url.search = new URLSearchParams({
      id: String(review.id),
      action: "approve",
      exp: String(exp),
      sig: await signModeration(SIGNING_KEY, review.id, "approve", exp),
    }).toString();
    expect((await confirm(url)).status).toBe(403);
  });

  it("rejects a signature made with another key", async () => {
    const review = pending();
    const forged = new URL(
      (
        await createModerationLink(
          ORIGIN,
          "another-key-that-is-long-enough-0123456789",
          review.id,
          "approve",
          NOW,
        )
      ).url,
    );
    expect((await confirm(forged)).status).toBe(403);
  });

  it("blocks cross-site and Origin: null posts", async () => {
    const review = pending();
    const url = await link(review.id, "approve");
    expect((await confirm(url, { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect((await confirm(url, { headers: { Origin: "null" } })).status).toBe(403);
    expect((await store.findById(review.id))?.status).toBe("pending");
  });

  it("ignores query-string parameters on POST (only the form body counts)", async () => {
    const review = pending();
    const url = await link(review.id, "approve");
    const req = await post(`${MODERATE_PATH}?${url.searchParams}`, new URLSearchParams(), { json: false });
    expect((await handleModeration(req, ctx)).status).toBe(403);
    expect((await store.findById(review.id))?.status).toBe("pending");
  });
});

describe("moderation configuration and errors", () => {
  it.each([
    ["no signing key", makeContext({ env: makeEnv({ REVIEW_SIGNING_KEY: undefined }) })],
    ["a short signing key", makeContext({ env: makeEnv({ REVIEW_SIGNING_KEY: "short" }) })],
    ["no DB binding", makeContext({ store: null })],
  ])("returns not_configured (503) with %s", async (_label, at) => {
    const url = await link(1, "approve");
    expect((await open(url, at)).status).toBe(503);
    expect((await confirm(url, {}, at)).status).toBe(503);
  });

  it("returns a generic error page when the database fails", async () => {
    const url = await link(pending().id, "approve");
    store.failWith = new Error("D1_ERROR: detail");
    const res = await confirm(url);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("detail");
  });

  it("answers other methods with 405", async () => {
    const res = await handleModeration(new Request(`${ORIGIN}${MODERATE_PATH}`, { method: "PUT" }), ctx);
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, POST");
  });
});
