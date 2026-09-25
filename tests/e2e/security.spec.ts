/** Security headers on static responses + no CSP violations where third-party/dynamic code runs. */
import { test, expect, trackCsp, waitForTurnstileToken } from "./fixtures";

test("static page responses include the security headers", async ({ request }) => {
  for (const route of ["/", "/quote", "/gallery/switch"]) {
    const res = await request.get(route);
    const h = res.headers();
    expect(h["x-content-type-options"], route).toBe("nosniff");
    expect(h["content-security-policy"], route).toContain("default-src 'self'");
    expect(h["content-security-policy"], route).toContain("frame-ancestors 'none'");
    expect(h["referrer-policy"], route).toBe("strict-origin-when-cross-origin");
    expect(h["x-frame-options"], route).toBe("DENY");
  }
});

test("the 404 response also carries the security headers", async ({ request }) => {
  const res = await request.get("/definitely-missing");
  expect(res.status()).toBe(404);
  expect(res.headers()["content-security-policy"]).toBeTruthy();
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

test("hashed assets are cached immutably", async ({ page, request }) => {
  await page.goto("/");
  const asset = await page.locator('link[rel="stylesheet"][href^="/_astro/"], script[src^="/_astro/"]').first().getAttribute("href").catch(() => null);
  const src = asset ?? (await page.locator('script[src^="/_astro/"]').first().getAttribute("src"));
  expect(src).toBeTruthy();
  const res = await request.get(src!);
  expect(res.headers()["cache-control"]).toContain("immutable");
});

test("no CSP violations on /quote while Turnstile loads and renders", async ({ page }) => {
  const violations = await trackCsp(page);
  await page.goto("/quote");
  await waitForTurnstileToken(page, "quote");
  expect(violations).toEqual([]);
});

test("no CSP violations on /gallery when the lightbox opens", async ({ page }) => {
  const violations = await trackCsp(page);
  await page.goto("/gallery");
  await page.getByRole("link", { name: /^Open photo:/ }).first().click();
  await expect(page.locator(".pswp")).toBeVisible();
  await expect(page.locator(".pswp__img").first()).toBeVisible();
  expect(violations).toEqual([]);
});

test("no secrets or server-only values leak into the client bundle", async ({ page, request }) => {
  await page.goto("/quote");
  const scripts = await page.locator("script[src]").evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).src));
  const html = await page.content();
  const bodies = [html];
  for (const s of scripts.filter((u) => u.includes("/_astro/"))) bodies.push(await (await request.get(s)).text());
  for (const b of bodies) {
    expect(b).not.toMatch(/re_[A-Za-z0-9]{20,}/); // Resend API key shape
    expect(b).not.toContain("TURNSTILE_SECRET_KEY");
    expect(b).not.toContain("RESEND_API_KEY");
    expect(b).not.toContain("1x0000000000000000000000000000000AA"); // the secret used for tests
  }
});
