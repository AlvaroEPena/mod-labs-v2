/** J6 old links + 404 + every route responds. */
import { test, expect, ROUTES, NOT_FOUND_PATH } from "./fixtures";

test("J6 /contact lands on /quote", async ({ page }) => {
  await page.goto("/contact");
  await expect(page).toHaveURL(/\/quote$/);
  await expect(page.locator("form#quote")).toBeVisible();
});

test("/contact answers with an HTTP redirect (301/302/308), not a 200 meta-refresh page", async ({ request }) => {
  const res = await request.get("/contact", { maxRedirects: 0 });
  expect([301, 302, 307, 308], `got ${res.status()}`).toContain(res.status());
  expect(res.headers()["location"]).toMatch(/\/quote$/);
});

test("an unknown route returns the themed 404 page with status 404", async ({ page }) => {
  const res = await page.goto(NOT_FOUND_PATH);
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "SIGNAL LOST" })).toBeVisible();
  await expect(page).toHaveTitle(/Signal lost/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  await page.getByRole("link", { name: /Back to home/ }).click();
  await expect(page).toHaveURL(/\/$/);
});

for (const route of ROUTES) {
  test(`GET ${route} → 200 with an h1 and no page errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const res = await page.goto(route);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await page.waitForLoadState("load");
    expect(errors).toEqual([]);
  });
}

test("/sitemap-index.xml and /robots.txt return 200 and reference each other", async ({ request }) => {
  const sm = await request.get("/sitemap-index.xml");
  expect(sm.status()).toBe(200);
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toMatch(/Sitemap:\s*\S+\/sitemap-index\.xml/i);

  const child = (await sm.text()).match(/<loc>([^<]+)<\/loc>/)?.[1];
  expect(child).toBeTruthy();
  const childRes = await request.get(new URL(child!).pathname);
  expect(childRes.status()).toBe(200);
  const urls = [...(await childRes.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  for (const r of ROUTES) expect(urls, `sitemap should list ${r}`).toContain(r);
  expect(urls.some((u) => /404|contact/.test(u))).toBe(false);
});
