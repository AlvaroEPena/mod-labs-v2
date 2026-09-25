/**
 * Responsive: no horizontal overflow at 375 / 768 / 1280 on every route, and the sticky
 * mobile CTA bar never covers the footer's last links or a form's submit button.
 * Viewports are set explicitly, so this runs in the desktop project only.
 */
import { test, expect, ROUTES, NOT_FOUND_PATH } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

const WIDTHS = [375, 768, 1280] as const;

// eslint-disable-next-line no-empty-pattern -- Playwright requires object destructuring here
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "viewport sizes are set explicitly; desktop project only");
});

async function overflow(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0) return false;
        // ignore content inside horizontal scrollers (tabs, carousels) and visually-hidden helpers
        if (el.closest(".tabs, [data-carousel], .carousel, .sr-only, .hp")) return false;
        return r.right > de.clientWidth + 1;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().split(" ").slice(0, 3).join(".")}`);
    return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, offenders };
  });
}

for (const width of WIDTHS) {
  for (const route of [...ROUTES, NOT_FOUND_PATH]) {
    test(`${width}px ${route}: no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(route);
      await page.waitForLoadState("load");
      const o = await overflow(page);
      expect(o.scrollWidth, `offenders: ${o.offenders.join(", ")}`).toBeLessThanOrEqual(o.clientWidth);
      // can the user actually scroll sideways?
      await page.evaluate(() => window.scrollTo({ left: 500, behavior: "instant" }));
      expect(await page.evaluate(() => window.scrollX)).toBe(0);
    });
  }

  test(`${width}px: navigation is usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    if (width < 1024) {
      await page.getByRole("button", { name: "Menu" }).click();
      const menu = page.locator("#mobile-menu");
      await expect(menu.getByRole("link", { name: "Gallery" })).toBeVisible();
      await menu.getByRole("link", { name: "Gallery" }).click();
    } else {
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Gallery" }).click();
    }
    await expect(page).toHaveURL(/\/gallery$/);
  });
}

async function coveredBy(target: Locator, cover: Locator) {
  const [a, b] = [await target.boundingBox(), await cover.boundingBox()];
  if (!a || !b) return false;
  return a.y + a.height > b.y && a.y < b.y + b.height && a.x < b.x + b.width && a.x + a.width > b.x;
}

test("375px: the sticky CTA bar does not cover the footer's last links at the bottom of the page", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  for (const route of ["/", "/gallery", "/faq"]) {
    await page.goto(route);
    const bar = page.getByRole("region", { name: "Quick actions" });
    await expect(bar).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    const footer = page.locator("footer");
    const lastLinks = [footer.getByRole("link").last(), footer.getByRole("link", { name: "Terms" })];
    for (const link of lastLinks) {
      expect(await coveredBy(link, bar), `${route}: ${await link.textContent()} covered by CTA bar`).toBe(false);
      // and it really receives the click (hit-test), not the bar
      const box = (await link.boundingBox())!;
      const hit = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.closest("a")?.getAttribute("href") ?? null,
        [box.x + box.width / 2, box.y + box.height / 2],
      );
      expect(hit).toBe(await link.getAttribute("href"));
    }
  }
});

test("375px: form pages hide the CTA bar, so it cannot cover the submit button", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  for (const [route, label] of [
    ["/book", "Send booking request"],
    ["/quote", "Send quote request"],
  ] as const) {
    await page.goto(route);
    const submit = page.getByRole("button", { name: label });
    await submit.scrollIntoViewIfNeeded();
    const bar = page.getByRole("region", { name: "Quick actions" });
    if ((await bar.count()) > 0 && (await bar.isVisible())) {
      expect(await coveredBy(submit, bar), `${route} submit covered`).toBe(false);
    }
    await expect(submit).toBeInViewport({ ratio: 1 });
  }
});
