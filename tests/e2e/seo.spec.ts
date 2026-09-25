/** SEO basics per route (spec §10). */
import { test, expect, ROUTES } from "./fixtures";

type Head = { title: string; description: string | null; canonical: string | null; ogImage: string | null; h1: number };

// eslint-disable-next-line no-empty-pattern -- Playwright requires object destructuring here
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "markup is identical across viewports; run once");
});

test("every route has a unique title, a description, a canonical link and og:image", async ({ page }) => {
  const heads: Record<string, Head> = {};
  for (const route of ROUTES) {
    await page.goto(route);
    heads[route] = await page.evaluate(() => ({
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? null,
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
      ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? null,
      h1: document.querySelectorAll("h1").length,
    }));
  }
  for (const [route, h] of Object.entries(heads)) {
    expect.soft(h.title.length, `${route} title`).toBeGreaterThan(10);
    expect.soft(h.description?.length ?? 0, `${route} description`).toBeGreaterThan(50);
    expect.soft(h.canonical, `${route} canonical`).toMatch(new RegExp(`^https://[^/]+${route === "/" ? "/" : route}$`));
    expect.soft(h.ogImage, `${route} og:image`).toMatch(/^https:\/\/.+\.(png|jpe?g|webp)$/);
    expect.soft(h.h1, `${route} h1 count`).toBe(1);
  }
  const titles = Object.values(heads).map((h) => h.title);
  expect(new Set(titles).size, `duplicate titles: ${titles.join(" | ")}`).toBe(titles.length);
  const descs = Object.values(heads).map((h) => h.description);
  expect(new Set(descs).size, "descriptions are unique").toBe(descs.length);
});

test("og.png, favicon and manifest are served", async ({ request }) => {
  for (const p of ["/og.png", "/favicon.ico", "/favicon.svg", "/apple-touch-icon.png", "/site.webmanifest"]) {
    expect((await request.get(p)).status(), p).toBe(200);
  }
});

test("home page carries LocalBusiness JSON-LD without a street address", async ({ page }) => {
  await page.goto("/");
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const parsed = blocks.map((b) => JSON.parse(b) as Record<string, unknown>);
  const biz = parsed.find((d) => JSON.stringify(d).includes("LocalBusiness"));
  expect(biz, "LocalBusiness JSON-LD").toBeTruthy();
  expect(JSON.stringify(biz)).toContain("Seattle");
  expect(JSON.stringify(biz)).not.toMatch(/streetAddress/);
});

test("/sitemap-index.xml and /robots.txt return 200", async ({ request }) => {
  expect((await request.get("/sitemap-index.xml")).status()).toBe(200);
  expect((await request.get("/robots.txt")).status()).toBe(200);
});
