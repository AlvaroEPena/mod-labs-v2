/** SEO basics per route (spec §10). */
import type { Page } from "@playwright/test";
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

/** every JSON-LD node on a page, with @graph flattened */
async function ldNodes(page: Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.flatMap((b) => {
    const d = JSON.parse(b) as Record<string, unknown>;
    return Array.isArray(d["@graph"]) ? (d["@graph"] as Record<string, unknown>[]) : [d];
  });
}

test("inner pages carry a BreadcrumbList that starts at Home and ends at the page", async ({ page }) => {
  for (const route of ROUTES.filter((r) => r !== "/")) {
    await page.goto(route);
    const crumbs = (await ldNodes(page)).find((n) => n["@type"] === "BreadcrumbList") as
      | { itemListElement: { position: number; name: string; item: string }[] }
      | undefined;
    expect.soft(crumbs, `${route} BreadcrumbList`).toBeTruthy();
    if (!crumbs) continue;
    const items = crumbs.itemListElement;
    expect.soft(items[0].name, route).toBe("Home");
    expect.soft(new URL(items.at(-1)!.item).pathname, route).toBe(route);
    expect.soft(items.map((i) => i.position), route).toEqual(items.map((_, i) => i + 1));
    // the visible trail mirrors it
    await expect.soft(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem")).toHaveCount(items.length);
  }
});

test("/services lists each priced mod as a Service with a USD Offer", async ({ page }) => {
  await page.goto("/services");
  const services = (await ldNodes(page)).filter((n) => n["@type"] === "Service");
  const priced = services.filter((s) => s.offers) as { name: string; offers: { price: number; priceCurrency: string } }[];
  expect(priced.length).toBeGreaterThanOrEqual(4);
  for (const s of priced) expect(s.offers, s.name).toMatchObject({ priceCurrency: "USD", price: expect.any(Number) });
});

test("/builds describes both builds as Products with a made-to-order USD Offer and an image", async ({ page }) => {
  await page.goto("/builds");
  const products = (await ldNodes(page)).filter((n) => n["@type"] === "Product") as {
    name: string;
    image: string[];
    offers: { price: number; priceCurrency: string; availability: string };
  }[];
  expect(products.map((p) => p.name)).toEqual(expect.arrayContaining([expect.stringMatching(/GWii/), expect.stringMatching(/Miicro/)]));
  for (const p of products) {
    expect(p.offers).toMatchObject({ priceCurrency: "USD", availability: "https://schema.org/MadeToOrder" });
    expect((await page.request.get(new URL(p.image[0]).pathname)).status(), `${p.name} image`).toBe(200);
  }
});

test("/faq carries FAQPage JSON-LD with every visible question", async ({ page }) => {
  await page.goto("/faq");
  const faq = (await ldNodes(page)).find((n) => n["@type"] === "FAQPage") as { mainEntity: { name: string }[] } | undefined;
  expect(faq).toBeTruthy();
  expect(faq!.mainEntity.length).toBe(await page.locator("main details.faq-item").count());
});
