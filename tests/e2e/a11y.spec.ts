/** axe on every route (fail on serious/critical), normal and prefers-reduced-motion. */
import AxeBuilder from "@axe-core/playwright";
import { test, expect, ROUTES, NOT_FOUND_PATH, renderWholePage, waitForLightboxOpen } from "./fixtures";
import type { Page } from "@playwright/test";

const ALL = [...ROUTES, NOT_FOUND_PATH];

/**
 * Gallery projects use content-visibility:auto. axe measures skipped (never-rendered) subtrees with
 * bogus geometry and reports false "target-size: partially obscured" hits on tiles that are really
 * 185x246 px, so each page is scrolled through once before auditing (as a visitor would).
 */
async function audit(page: Page, { render = true } = {}) {
  if (render) await renderWholePage(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    // the third-party Turnstile iframe is Cloudflare's markup, not ours
    .exclude('iframe[src*="challenges.cloudflare.com"]')
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
}

for (const route of ALL) {
  test(`axe: ${route} has no serious/critical violations`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState("load");
    expect(await audit(page)).toEqual([]);
  });
}

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  for (const route of ALL) {
    test(`axe (reduced motion): ${route}`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("load");
      expect(await audit(page)).toEqual([]);
    });
  }

  test("reduced motion: reveal content is visible without scrolling animations", async ({ page }) => {
    await page.goto("/builds");
    const reveals = page.locator("main .reveal");
    expect(await reveals.count()).toBeGreaterThan(0);
    // jump to the bottom without scrolling through: everything must already be fully opaque
    const hidden = await reveals.evaluateAll((els) =>
      els.filter((e) => Number(getComputedStyle(e).opacity) < 1).map((e) => e.className),
    );
    expect(hidden).toEqual([]);
  });
});

test("axe: open gallery lightbox has no serious/critical violations", async ({ page }) => {
  await page.goto("/gallery/switch");
  await page.getByRole("link", { name: /^Open photo:/ }).first().click();
  await waitForLightboxOpen(page);
  expect(await audit(page, { render: false })).toEqual([]);
});

test("axe: /book with inline errors shown", async ({ page }) => {
  await page.goto("/book");
  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page.locator('[data-error-for="services"]')).not.toBeEmpty();
  expect(await audit(page, { render: false })).toEqual([]);
});

test("axe: open mobile menu", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile only");
  await page.goto("/");
  await page.getByRole("button", { name: "Menu" }).tap();
  await expect(page.locator("#mobile-menu")).toBeVisible();
  expect(await audit(page, { render: false })).toEqual([]);
});
