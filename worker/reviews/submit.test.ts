import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewFields } from "../../src/lib/reviews/contract";
import { reviewMemoryLimiter } from "../lib/ratelimit";
import { TURNSTILE_VERIFY_URL } from "../lib/integrations";
import { MemoryReviewStore } from "./memory-store";
import { parseModerationParams, verifyModeration } from "./signing";
import { handleReviewSubmit, MAX_NEW_REVIEWS_PER_DAY, MAX_REVIEW_BODY_BYTES } from "./submit";
import {
  DAY_MS,
  LOCAL,
  makeContext,
  makeEnv,
  mockNetwork,
  NOW,
  ORIGIN,
  post,
  resendCalls,
  resendPayload,
  reviewForm,
  sampleReview,
  SIGNING_KEY,
  TEST_TURNSTILE_SECRET,
  type NetworkMock,
} from "./testing";

let net: NetworkMock;
let store: MemoryReviewStore;

beforeEach(() => {
  reviewMemoryLimiter.reset();
  store = new MemoryReviewStore();
  net = mockNetwork();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const submit = async (
  fd: FormData,
  opts: Parameters<typeof post>[2] = {},
  ctxOpts: Parameters<typeof makeContext>[0] = {},
) => handleReviewSubmit(await post("/api/review", fd, opts), makeContext({ store, ...ctxOpts }));

const moderationLinks = (text: string) =>
  [...text.matchAll(/https?:\/\/[^\s"<]+\/api\/reviews\/moderate\?[^\s"<]+/g)].map(
    (m) => new URL(m[0].replace(/&amp;/g, "&")),
  );

describe("POST /api/review: success", () => {
  it("stores the review as pending and emails signed Approve/Delete links (send mode)", async () => {
    const res = await submit(reviewForm());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: expect.stringContaining("once it's approved") });

    const rows = store.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...sampleReview(), status: "pending", createdAt: NOW, approvedAt: null });

    const p = resendPayload(net);
    expect(p.to).toEqual(["al@example.com"]);
    expect(p.reply_to).toBeUndefined(); // no reviewer email is collected
    expect(p.subject).toBe("New review: 5★ from Jordan M. (approve or delete)");
    const links = moderationLinks(String(p.text));
    expect(links.map((u) => u.searchParams.get("action"))).toEqual(["approve", "delete"]);
    for (const link of links) {
      expect(link.origin).toBe(ORIGIN);
      const params = parseModerationParams((k) => link.searchParams.get(k));
      expect(params?.id).toBe(rows[0]?.id);
      expect(params && (await verifyModeration(SIGNING_KEY, params, NOW))).toBe("ok");
    }
    const [approve, remove] = links.map((u) => Number(u.searchParams.get("exp")) * 1000 - NOW);
    expect(approve).toBe(30 * DAY_MS);
    expect(remove).toBe(365 * DAY_MS);
    expect(moderationLinks(String(p.html))).toHaveLength(2);
  });

  it("escapes review text in the moderation email", async () => {
    await submit(reviewForm({ [reviewFields.body]: `<script>alert("x")</script> great repair, fast too` }));
    const html = String(resendPayload(net).html);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("stores empty service/source as null", async () => {
    await submit(reviewForm({ [reviewFields.service]: "", [reviewFields.source]: "" }));
    expect(store.all()[0]).toMatchObject({ service: null, source: null });
  });

  it("logs the links instead of emailing in log mode on localhost", async () => {
    const env = makeEnv({
      EMAIL_MODE: "log",
      RESEND_API_KEY: undefined,
      TURNSTILE_SECRET_KEY: TEST_TURNSTILE_SECRET,
    });
    net.siteverify = { success: true, hostname: "example.com" };
    const res = await submit(reviewForm(), { origin: LOCAL }, { env });
    expect(res.status).toBe(200);
    expect(resendCalls(net)).toHaveLength(0);
    const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
    expect(logged).toContain("[review moderation]");
    expect(moderationLinks(logged).map((u) => u.origin)).toEqual([LOCAL, LOCAL]);
    expect(store.all()).toHaveLength(1);
  });

  it("redirects no-JS posts to /reviews?sent=1", async () => {
    const res = await submit(reviewForm(), { json: false });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`${ORIGIN}/reviews?sent=1`);
  });
});

describe("POST /api/review: rejections", () => {
  it("returns fieldErrors and stores nothing on invalid input", async () => {
    const res = await submit(
      reviewForm({ [reviewFields.rating]: "9", [reviewFields.name]: "<b>", [reviewFields.consent]: "" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; fieldErrors: Record<string, string[]> };
    expect(body.error).toBe("validation");
    expect(Object.keys(body.fieldErrors).sort()).toEqual(["consent", "name", "rating"]);
    expect(store.all()).toHaveLength(0);
    expect(resendCalls(net)).toHaveLength(0);
  });

  it.each([
    ["https://spam.example/deal"],
    ["visit www.cheapmods.example now"],
    ["cheapmods.xyz has deals for you"],
  ])("rejects links: %s", async (link) => {
    const res = await submit(reviewForm({ [reviewFields.body]: `Great service, also ${link} thanks!` }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      fieldErrors: { body: ["Please leave links out of your review."] },
    });
    expect(store.all()).toHaveLength(0);
  });

  it("redirects no-JS validation failures to /reviews?error=validation", async () => {
    const res = await submit(reviewForm({ [reviewFields.body]: "short" }), { json: false });
    expect(res.headers.get("Location")).toBe(`${ORIGIN}/reviews?error=validation`);
  });

  it("pretends success on a honeypot hit without storing, verifying or sending", async () => {
    const res = await submit(reviewForm({ [reviewFields.honeypot]: "bot" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(store.all()).toHaveLength(0);
    expect(net.calls).toHaveLength(0);
  });

  it("returns captcha (403) when Turnstile rejects, the token is missing or the action is wrong", async () => {
    net.siteverify = { success: false };
    expect((await submit(reviewForm())).status).toBe(403);
    net.siteverify = { success: true, hostname: "mod-labs.example.workers.dev", action: "book" };
    expect((await submit(reviewForm())).status).toBe(403);
    const before = net.calls.length;
    const res = await submit(reviewForm({ [reviewFields.turnstile]: "" }));
    expect(await res.json()).toMatchObject({ ok: false, error: "captcha" });
    expect(net.calls).toHaveLength(before);
    expect(store.all()).toHaveLength(0);
  });

  it("verifies Turnstile with the review action and the request hostname", async () => {
    net.siteverify = { success: true, hostname: "evil.example", action: "review" };
    expect((await submit(reviewForm())).status).toBe(403);
    expect(net.calls.find((c) => c.url === TURNSTILE_VERIFY_URL)).toBeTruthy();
  });

  it("rate limits the third submission within a minute from one IP (in-memory fallback)", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await submit(reviewForm(), { headers: { "CF-Connecting-IP": "192.0.2.9" } })).status);
    }
    expect(statuses).toEqual([200, 200, 429]);
  });

  it("uses the REVIEW_RATE_LIMITER binding with a review: key when configured", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const env = makeEnv({ REVIEW_RATE_LIMITER: { limit } as unknown as RateLimit });
    const res = await submit(reviewForm(), {}, { env });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "rate_limited" });
    expect(limit).toHaveBeenCalledWith({ key: expect.stringMatching(/^review:/) });
  });

  it("caps new reviews per rolling 24 h", async () => {
    for (let i = 0; i < MAX_NEW_REVIEWS_PER_DAY; i++)
      store.seed({ ...sampleReview(), createdAt: NOW - DAY_MS + 1000 + i });
    store.seed({ ...sampleReview(), createdAt: NOW - 2 * DAY_MS });
    const res = await submit(reviewForm());
    expect(res.status).toBe(429);
    expect(store.all()).toHaveLength(MAX_NEW_REVIEWS_PER_DAY + 1);
    expect(resendCalls(net)).toHaveLength(0);
  });

  it("rejects oversized bodies before parsing", async () => {
    const res = await submit(reviewForm(), {
      headers: { "Content-Length": String(MAX_REVIEW_BODY_BYTES + 1) },
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "too_large" });
  });

  it("rejects cross-site posts and non-POST methods", async () => {
    expect((await submit(reviewForm(), { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    const get = await handleReviewSubmit(new Request(`${ORIGIN}/api/review`), makeContext({ store }));
    expect(get.status).toBe(405);
    expect(get.headers.get("Allow")).toBe("POST");
    expect(net.calls).toHaveLength(0);
  });
});

describe("POST /api/review: configuration and failures", () => {
  it.each([
    ["no DB binding", { store: null }],
    ["no signing key", { env: makeEnv({ REVIEW_SIGNING_KEY: undefined }) }],
    ["a short signing key", { env: makeEnv({ REVIEW_SIGNING_KEY: "too-short" }) }],
    ["no Resend key in send mode", { env: makeEnv({ RESEND_API_KEY: undefined }) }],
    [
      "a Turnstile TEST secret in send mode",
      { env: makeEnv({ TURNSTILE_SECRET_KEY: TEST_TURNSTILE_SECRET }) },
    ],
  ])("returns not_configured (503) with %s", async (_label, ctxOpts) => {
    const res = await submit(reviewForm(), {}, ctxOpts as Parameters<typeof makeContext>[0]);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "not_configured" });
    expect(store.all()).toHaveLength(0);
    expect(resendCalls(net)).toHaveLength(0);
  });

  it("removes the pending row and returns 502 when the email can't be sent", async () => {
    net.resendStatus = 500;
    const res = await submit(reviewForm());
    expect(res.status).toBe(502);
    expect(store.all()).toHaveLength(0);
  });

  it("returns a generic server error (no details) when the database fails", async () => {
    store.failWith = new Error("D1_ERROR: secret detail");
    const res = await submit(reviewForm());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
});
