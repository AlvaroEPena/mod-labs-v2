/** J4 Browse work on a phone (spec §4) + gallery category routes. */
import type { Page } from "@playwright/test";
import { test, expect, GALLERY_CATEGORIES, waitForLightboxOpen } from "./fixtures";

const counter = (page: Page) => page.locator(".pswp .pswp__counter");

/** A real touch swipe (CDP touch events) from right to left across the lightbox. */
async function touchSwipeLeft(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const { width, height } = page.viewportSize()!;
  const y = Math.round(height / 2);
  const pts = [0.85, 0.7, 0.55, 0.4, 0.25, 0.15].map((f) => Math.round(width * f));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pts[0], y }] });
  for (const x of pts.slice(1)) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test.describe("J4 gallery", () => {
  test("filter → /gallery/switch → open photo → next → Esc closes and focus returns", async ({ page, isMobile }) => {
    await page.goto("/gallery");
    const tabs = page.getByRole("navigation", { name: "Gallery categories" });
    const switchTab = tabs.getByRole("link", { name: /^Switch/ });
    if (isMobile) await switchTab.tap();
    else await switchTab.click();
    await expect(page).toHaveURL(/\/gallery\/switch$/);
    // module scripts (the lightbox) run before DOMContentLoaded; a tap before that follows the plain link
    await page.waitForLoadState("domcontentloaded");
    await expect(tabs.getByRole("link", { name: /^Switch/ })).toHaveAttribute("aria-current", "page");

    const firstTile = page.getByRole("link", { name: /^Open photo:/ }).first();
    await firstTile.scrollIntoViewIfNeeded();
    if (isMobile) await firstTile.tap();
    else await firstTile.click();

    await waitForLightboxOpen(page);
    await expect(counter(page)).toHaveText(/^1 \/ \d+$/);
    // the lightbox adds a history entry, not a navigation
    await expect(page).toHaveURL(/\/gallery\/switch$/);

    if (isMobile) await touchSwipeLeft(page);
    else await page.keyboard.press("ArrowRight");
    await expect(counter(page)).toHaveText(/^2 \/ \d+$/);

    await page.keyboard.press("Escape");
    await expect(page.locator(".pswp")).toHaveCount(0);
    await expect(firstTile).toBeFocused();
    await expect(page).toHaveURL(/\/gallery\/switch$/);
  });

  test("keyboard arrows move between photos in the lightbox", async ({ page }) => {
    await page.goto("/gallery/switch");
    await page.getByRole("link", { name: /^Open photo:/ }).first().click();
    await waitForLightboxOpen(page);
    await page.keyboard.press("ArrowRight");
    await expect(counter(page)).toHaveText(/^2 \//);
    await page.keyboard.press("ArrowLeft");
    await expect(counter(page)).toHaveText(/^1 \//);
  });

  test("the Next button advances (pointer devices)", async ({ page, isMobile }) => {
    test.skip(isMobile, "PhotoSwipe hides arrow buttons on touch-only devices; swipe is covered above");
    await page.goto("/gallery/switch");
    await page.getByRole("link", { name: /^Open photo:/ }).first().click();
    await waitForLightboxOpen(page);
    await page.locator(".pswp").getByRole("button", { name: "Next photo" }).click();
    await expect(counter(page)).toHaveText(/^2 \//);
  });

  test("the browser back button/gesture closes the lightbox and stays on the page", async ({ page }) => {
    await page.goto("/gallery/switch");
    await page.getByRole("link", { name: /^Open photo:/ }).first().click();
    await waitForLightboxOpen(page);
    await page.goBack();
    await expect(page.locator(".pswp")).toHaveCount(0);
    await expect(page).toHaveURL(/\/gallery\/switch$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("mouse drag (swipe) moves to the next photo", async ({ page, isMobile }) => {
    test.skip(isMobile, "touch swipe is covered in the journey test");
    await page.goto("/gallery/switch");
    await page.getByRole("link", { name: /^Open photo:/ }).first().click();
    await waitForLightboxOpen(page);
    const vp = page.viewportSize()!;
    await page.mouse.move(vp.width * 0.8, vp.height / 2);
    await page.mouse.down();
    await page.mouse.move(vp.width * 0.5, vp.height / 2, { steps: 8 });
    await page.mouse.move(vp.width * 0.2, vp.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(counter(page)).toHaveText(/^2 \//);
  });

  test("gallery tiles are real links to the large image (works without JS)", async ({ page }) => {
    await page.goto("/gallery/switch");
    const href = await page.getByRole("link", { name: /^Open photo:/ }).first().getAttribute("href");
    expect(href).toMatch(/^\/_astro\/.+\.webp$/);
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/webp");
  });

  for (const cat of ["", ...GALLERY_CATEGORIES.map((c) => `/${c}`)]) {
    test(`GET /gallery${cat} returns 200 with its own heading`, async ({ page }) => {
      const res = await page.goto(`/gallery${cat}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Open photo:/ }).first()).toBeAttached();
    });
  }

  test("an unknown gallery category is a 404", async ({ page }) => {
    const res = await page.goto("/gallery/nintendo-64");
    expect(res?.status()).toBe(404);
  });
});
