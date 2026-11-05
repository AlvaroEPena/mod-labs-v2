/**
 * Runs the bundled Worker in workerd (Miniflare) with a real D1 database built from migrations/, so the
 * SQL, the migration and HTMLRewriter (which Node doesn't have) are exercised exactly as deployed.
 */
import { build } from "esbuild";
import {
  convertV4MiniflareOptions,
  Miniflare,
  Response as MiniflareResponse,
  type Request as MiniflareRequest,
} from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import migrationSql from "../../migrations/0001_create_reviews.sql?raw";
import { renderReviewItem, summarize, summaryText, type PublicReview } from "../../src/lib/reviews/contract";
import { createModerationLink, MODERATE_PATH, type ModerationAction } from "./signing";
import { D1ReviewStore, LIST_APPROVED_SQL, MAX_PUBLISHED_REVIEWS, type NewReview } from "./store";
import {
  describeReviewStoreContract,
  sampleReview,
  SIGNING_KEY,
  TEST_TURNSTILE_SECRET,
  validReviewFields,
} from "./testing";

const ORIGIN = "http://localhost";
const ASSET_ETAG = '"asset-v1"';
const PAGE = (title: string, slot: "home" | "all") =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body>` +
  `<p data-reviews-summary>Be the first to leave a review.</p>` +
  `<p data-reviews-when-empty>No reviews yet.</p>` +
  `<section data-reviews-when-any hidden><ul data-reviews-slot="${slot}"><li>placeholder</li></ul></section>` +
  `</body></html>`;
const PAGES: Record<string, string> = { "/": PAGE("Home", "home"), "/reviews": PAGE("Reviews", "all") };

/** Stand-in for the static assets binding, including its own conditional-GET handling. */
const assetRequests: { path: string; ifNoneMatch: string | null }[] = [];
function serveAsset(request: MiniflareRequest): MiniflareResponse {
  const { pathname } = new URL(request.url);
  const ifNoneMatch = request.headers.get("If-None-Match");
  assetRequests.push({ path: pathname, ifNoneMatch });
  const html = PAGES[pathname];
  if (!html) return new MiniflareResponse("not found", { status: 404 });
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    ETag: ASSET_ETAG,
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Content-Security-Policy": "default-src 'self'",
  };
  if (ifNoneMatch === ASSET_ETAG) return new MiniflareResponse(null, { status: 304, headers });
  return new MiniflareResponse(html, { headers });
}

/** Migration file → statements (it has no semicolons inside strings). */
const statements = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

async function migrate(db: D1Database): Promise<void> {
  await db.batch(statements(migrationSql).map((s) => db.prepare(s)));
}

/** Bundle worker/index.ts the way wrangler does (ESM, workerd conditions). */
async function bundleWorker(): Promise<string> {
  const result = await build({
    entryPoints: ["worker/index.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2023",
    conditions: ["workerd", "worker", "browser"],
    mainFields: ["module", "main"],
    logLevel: "silent",
  });
  return result.outputFiles[0]?.text ?? "";
}

/**
 * Miniflare 5 takes a new option shape; convertV4MiniflareOptions accepts the documented one.
 * The installed workerd's newest supported date can trail wrangler.jsonc's by a day; behaviour is identical.
 */
const RUNTIME = { modules: true, compatibilityDate: "2026-09-23", compatibilityFlags: ["nodejs_compat"] };

let script: string;
let mf: Miniflare;
let pagesDb: D1Database;
let storeDb: D1Database;

beforeAll(async () => {
  script = await bundleWorker();
  mf = new Miniflare(
    convertV4MiniflareOptions({
      ...RUNTIME,
      script,
      d1Databases: { DB: "pages-db", STORE_TEST_DB: "store-db" },
      bindings: {
        EMAIL_MODE: "log",
        REVIEW_SIGNING_KEY: SIGNING_KEY,
        TURNSTILE_SECRET_KEY: TEST_TURNSTILE_SECRET,
      },
      serviceBindings: { ASSETS: serveAsset },
      // Turnstile siteverify (the only outbound call in log mode) answers like the always-pass test secret.
      outboundService: () => MiniflareResponse.json({ success: true, hostname: "example.com" }),
    }),
  );
  pagesDb = (await mf.getD1Database("DB")) as unknown as D1Database;
  storeDb = (await mf.getD1Database("STORE_TEST_DB")) as unknown as D1Database;
  await migrate(pagesDb);
  await migrate(storeDb);
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
});

describeReviewStoreContract("D1ReviewStore (real D1, migrations/0001)", async () => {
  await storeDb.prepare("DELETE FROM reviews").run();
  return new D1ReviewStore(storeDb);
});

describe("D1 schema", () => {
  it("enforces the rating range, status values and approved_at consistency", async () => {
    const insert = (rating: number, status: string, approvedAt: number | null) =>
      storeDb
        .prepare(
          "INSERT INTO reviews (name, rating, body, status, created_at, approved_at) VALUES ('x', ?, 'body', ?, 1, ?)",
        )
        .bind(rating, status, approvedAt)
        .run();
    await expect(insert(6, "pending", null)).rejects.toThrow();
    await expect(insert(5, "published", null)).rejects.toThrow();
    await expect(insert(5, "approved", null)).rejects.toThrow();
    await expect(insert(5, "pending", 1)).rejects.toThrow();
    await expect(insert(5, "approved", 1)).resolves.toBeTruthy();
  });

  it("uses the partial index for the published list", async () => {
    const plan = await storeDb
      .prepare(`EXPLAIN QUERY PLAN ${LIST_APPROVED_SQL}`)
      .bind(MAX_PUBLISHED_REVIEWS)
      .all<{ detail: string }>();
    expect(plan.results.map((r) => r.detail).join(" ")).toContain("idx_reviews_approved");
  });
});

const fetchPage = (path: string, headers: Record<string, string> = {}) =>
  mf.dispatchFetch(`${ORIGIN}${path}`, { headers });

/** A same-origin urlencoded form POST with Content-Length, like a browser sends (dispatchFetch would stream it). */
function postForm(path: string, form: URLSearchParams, headers: Record<string, string> = {}) {
  const body = form.toString();
  return mf.dispatchFetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": String(new TextEncoder().encode(body).byteLength),
      ...headers,
    },
    body,
  });
}

async function seedApproved(review: NewReview, approvedAt: number): Promise<PublicReview> {
  const store = new D1ReviewStore(pagesDb);
  const id = await store.insertPending(review, approvedAt - 1000);
  await store.approve(id, approvedAt);
  return { id, ...review, approvedAt };
}

/** Moderate through the Worker like the owner does: the confirmation page's form POST. */
async function moderate(id: number, action: ModerationAction): Promise<Response> {
  const url = new URL((await createModerationLink(ORIGIN, SIGNING_KEY, id, action, Date.now())).url);
  return (await postForm(MODERATE_PATH, url.searchParams)) as unknown as Response;
}

describe("publishing approved reviews with HTMLRewriter", () => {
  beforeEach(() => {
    assetRequests.length = 0;
  });

  // Ordered steps: the Worker's per-isolate cache means DB changes only show up through moderation (purge).
  let reviews: PublicReview[] = [];

  it("serves the page byte-for-byte unchanged while nothing is approved", async () => {
    const res = await fetchPage("/");
    expect(await res.text()).toBe(PAGES["/"]);
    expect(res.headers.get("ETag")).toBe(ASSET_ETAG);
    const conditional = await fetchPage("/", { "If-None-Match": ASSET_ETAG });
    expect(conditional.status).toBe(304); // the asset layer's own validators still work
  });

  it("injects approved reviews (newest first, escaped), the summary and the visibility toggles", async () => {
    const t = Date.now();
    // Seed directly, then publish a pending one through the Worker so its cache is purged.
    reviews = [
      await seedApproved(sampleReview({ name: "Oldest" }), t - 4000),
      await seedApproved(
        sampleReview({
          name: "Script Kid",
          body: `<script>alert("x")</script> & <img src=x onerror=alert(1)> great job`,
        }),
        t - 3000,
      ),
      await seedApproved(sampleReview({ name: "Third", rating: 4 }), t - 2000),
    ];
    const newest = await new D1ReviewStore(pagesDb).insertPending(
      sampleReview({ name: "Newest", service: null, source: "A friend" }),
      t - 1000,
    );
    await new D1ReviewStore(pagesDb).insertPending(sampleReview({ name: "Still Pending" }), t);
    expect((await moderate(newest, "approve")).status).toBe(200);
    const approvedNewest = await new D1ReviewStore(pagesDb).findById(newest);
    reviews.push({
      id: newest,
      ...sampleReview({ name: "Newest", service: null, source: "A friend" }),
      approvedAt: approvedNewest?.approvedAt ?? 0,
    });
    const newestFirst = [...reviews].reverse();

    const home = await (await fetchPage("/")).text();
    const homeItems = newestFirst.slice(0, 3).map(renderReviewItem).join("");
    expect(home).toContain(`<ul data-reviews-slot="home">${homeItems}</ul>`);
    expect(home).not.toContain("Oldest"); // only the latest 3 on the home page
    expect(home).not.toContain("Still Pending");
    expect(home).not.toContain("placeholder");
    expect(home).toContain(`<p data-reviews-summary>${summaryText(summarize(reviews))}</p>`);
    expect(home).toContain(`<p data-reviews-when-empty hidden="">No reviews yet.</p>`);
    expect(home).toContain(`<section data-reviews-when-any>`);

    const all = await (await fetchPage("/reviews")).text();
    expect(all).toContain(`<ul data-reviews-slot="all">${newestFirst.map(renderReviewItem).join("")}</ul>`);
    expect(all).not.toContain("<script>alert");
    expect(all).not.toContain("<img src=x");
    expect(all).toContain(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;img src=x onerror=alert(1)&gt;",
    );
    expect(all).toContain("Referred by a friend");
  });

  it("keeps the asset's headers, sets a content-derived weak ETag and answers conditional requests", async () => {
    const res = await fetchPage("/", { "If-None-Match": ASSET_ETAG });
    expect(res.status).toBe(200); // the browser's copy predates the reviews
    expect(assetRequests.at(-1)?.ifNoneMatch).toBeNull(); // validators aren't forwarded when rewriting
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'self'");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
    const etag = res.headers.get("ETag") ?? "";
    expect(etag).toMatch(/^W\/"asset-v1\.[0-9a-f]{16}"$/);
    await res.text();

    const revalidated = await fetchPage("/", { "If-None-Match": etag });
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe("");
    const head = await mf.dispatchFetch(`${ORIGIN}/reviews`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("ETag")).toMatch(/^W\//);
  });

  it("passes non-200 asset responses through untouched", async () => {
    const res = await fetchPage("/reviews.html"); // the stub has no such page
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
  });

  it("returns the same list from GET /api/reviews", async () => {
    const res = await mf.dispatchFetch(`${ORIGIN}/api/reviews`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      reviews: PublicReview[];
      count: number;
      average: number;
    };
    expect(body.ok).toBe(true);
    expect(body.reviews.map((r) => r.name)).toEqual([...reviews].reverse().map((r) => r.name));
    expect(body.count).toBe(4);
    expect(body.average).toBe(summarize(reviews).average);
  });

  it("changes the page and its ETag after moderation (delete purges the cache)", async () => {
    const before = (await fetchPage("/reviews")).headers.get("ETag");
    const scriptKid = reviews.find((r) => r.name === "Script Kid");
    expect((await moderate(scriptKid?.id ?? 0, "delete")).status).toBe(200);
    const after = await fetchPage("/reviews");
    expect(after.headers.get("ETag")).not.toBe(before);
    expect(await after.text()).not.toContain("Script Kid");
  });

  it("runs the full submit → pending → approve flow through the Worker", async () => {
    const form = new URLSearchParams(validReviewFields());
    form.set("name", "Flow Tester");
    const submitted = await postForm("/api/review", form, { Accept: "application/json" });
    expect(submitted.status).toBe(200);
    expect(await submitted.json()).toMatchObject({ ok: true });
    const row = await pagesDb
      .prepare("SELECT id, status FROM reviews WHERE name = 'Flow Tester'")
      .first<{ id: number; status: string }>();
    expect(row?.status).toBe("pending");
    expect(await (await fetchPage("/reviews")).text()).not.toContain("Flow Tester");

    const confirmPage = await mf.dispatchFetch(
      new URL(
        (await createModerationLink(ORIGIN, SIGNING_KEY, row?.id ?? 0, "approve", Date.now())).url,
      ).toString(),
    );
    expect(await confirmPage.text()).toContain("Publish this review?");
    expect(
      await pagesDb.prepare("SELECT status FROM reviews WHERE id = ?").bind(row?.id).first<string>("status"),
    ).toBe("pending");

    expect((await moderate(row?.id ?? 0, "approve")).status).toBe(200);
    expect(await (await fetchPage("/reviews")).text()).toContain("Flow Tester");
  });

  it("serves the page unchanged once every review is deleted", async () => {
    const { results } = await pagesDb.prepare("SELECT id FROM reviews").all<{ id: number }>();
    for (const { id } of results) expect((await moderate(id, "delete")).status).toBe(200);
    expect(await (await fetchPage("/")).text()).toBe(PAGES["/"]);
  });
});

describe("degrading when the database is unusable", () => {
  // (A missing DB binding is covered in units.test.ts.)
  it("serves the page untouched when the reviews query fails", async () => {
    // A database without the migration: every query fails.
    await mf.setOptions(
      convertV4MiniflareOptions({
        ...RUNTIME,
        script,
        d1Databases: { DB: "unmigrated-db" },
        bindings: { REVIEW_SIGNING_KEY: SIGNING_KEY },
        serviceBindings: { ASSETS: serveAsset },
      }),
    );
    await mf.purgeCache(); // the Cache API copy outlives setOptions
    const broken = await fetchPage("/");
    expect(broken.status).toBe(200);
    expect(await broken.text()).toBe(PAGES["/"]);
    expect((await mf.dispatchFetch(`${ORIGIN}/api/reviews`)).status).toBe(500);
  }, 60_000);
});
