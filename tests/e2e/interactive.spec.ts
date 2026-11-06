/**
 * Phase 2 interactive pieces (spec §16/§17): Switch model tabs (/services), the build spec explorer
 * (/builds), the live FAQ filter, the legal table of contents and the gallery filter pill.
 * Each must work by keyboard and touch, and degrade to plain content without JS.
 */
import { test, expect } from "./fixtures";
import { builds } from "../../src/data/builds";
import { faqs } from "../../src/data/faq";

test.describe("Switch model tabs (/services)", () => {
  test("OLED is selected first; clicking or arrowing switches the one visible panel", async ({ page, isMobile }) => {
    await page.goto("/services");
    const tabs = page.getByRole("tablist", { name: "Switch model" });
    await expect(tabs).toBeVisible();
    const oled = tabs.getByRole("tab", { name: /OLED/ });
    await expect(oled).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await expect(page.locator("#switch-oled")).toBeVisible();
    await expect(page.locator("#switch-lite")).toBeHidden();

    const v1 = tabs.getByRole("tab", { name: /V1 \/ V2/ });
    if (isMobile) await v1.tap();
    else await v1.click();
    await expect(v1).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#switch-v1-v2")).toBeVisible();
    await expect(page.locator("#switch-oled")).toBeHidden();
    await expect(page.getByRole("tabpanel").getByRole("link", { name: /Book this mod/ })).toHaveAttribute("href", "/book?service=switch-v1-v2");

    await v1.focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: /Lite/ })).toBeFocused();
    await expect(page.locator("#switch-lite")).toBeVisible();
    await page.keyboard.press("Home");
    await expect(oled).toBeFocused();
    await expect(oled).toHaveAttribute("aria-selected", "true");
  });

  test("a price-board row deep-links to its model's tab", async ({ page }) => {
    await page.goto("/services");
    await page.getByRole("navigation", { name: "Prices at a glance" }).getByRole("link", { name: /Switch Lite/ }).click();
    await expect(page).toHaveURL(/#switch-lite$/);
    await expect(page.getByRole("tab", { name: /Lite/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#switch-lite")).toBeInViewport();
  });

  test("/services#switch-lite opens on the Lite tab", async ({ page }) => {
    await page.goto("/services#switch-lite");
    await expect(page.getByRole("tab", { name: /Lite/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#switch-lite")).toBeVisible();
  });

  test("without JS every Switch model's panel (and its exact includes list) is on the page", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto("/services");
    for (const id of ["switch-oled", "switch-v1-v2", "switch-lite"]) await expect(page.locator(`#${id}`)).toBeVisible();
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await ctx.close();
  });
});

test.describe("build spec explorer (/builds)", () => {
  for (const b of builds) {
    test(`${b.slug}: one readout at a time, switched by tap or arrow keys`, async ({ page, isMobile }) => {
      await page.goto("/builds");
      const pads = page.getByRole("tablist", { name: `${b.name} features` });
      await pads.scrollIntoViewIfNeeded();
      await expect(pads.getByRole("tab")).toHaveCount(b.features.length);
      const section = page.locator(`section#${b.slug}`);
      await expect(section.getByRole("tabpanel")).toHaveCount(1);
      await expect(section.getByRole("tabpanel")).toContainText(b.features[0].detail);

      const last = b.features.at(-1)!;
      const lastPad = pads.getByRole("tab", { name: last.title });
      if (isMobile) await lastPad.tap();
      else await lastPad.click();
      await expect(lastPad).toHaveAttribute("aria-selected", "true");
      await expect(section.getByRole("tabpanel")).toContainText(last.detail);

      await lastPad.focus();
      await page.keyboard.press("ArrowRight"); // wraps to the first pad
      await expect(pads.getByRole("tab").first()).toBeFocused();
      await expect(section.getByRole("tabpanel")).toContainText(b.features[0].detail);
      await page.keyboard.press("ArrowDown"); // a grid of pads answers to all four arrows
      await expect(pads.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
    });
  }

  test("without JS every feature's detail is shown", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto("/builds");
    for (const f of builds[0].features) await expect(page.locator(`section#${builds[0].slug}`).getByText(f.detail)).toBeVisible();
    await ctx.close();
  });
});

test.describe("FAQ filter", () => {
  test("typing narrows the questions, reports the count, offers a way to ask, and Esc clears", async ({ page }) => {
    await page.goto("/faq");
    const search = page.getByRole("searchbox", { name: "Search the questions" });
    const items = page.locator("main details.faq-item");
    const count = page.locator("[data-faq-count]");
    await expect(count).toHaveText(`All ${faqs.length} questions`);

    await search.fill("mail");
    const expected = faqs.filter((f) => /mail/i.test(`${f.q} ${f.a}`)).length;
    await expect(items.filter({ visible: true })).toHaveCount(expected);
    await expect(count).toHaveText(new RegExp(`^${expected} of ${faqs.length} question`));
    await expect(items.filter({ hasText: "Do you do mail-in?" })).toBeVisible();

    await search.fill("zzqx");
    await expect(items.filter({ visible: true })).toHaveCount(0);
    await expect(count).toHaveText("No questions match");
    await expect(page.locator("[data-faq-empty]")).toBeVisible();
    await expect(page.locator("[data-faq-empty]").getByRole("link", { name: "Ask a question" })).toHaveAttribute("href", "/quote");

    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(items.filter({ visible: true })).toHaveCount(faqs.length);
  });

  test("without JS there's no dead search box and every answer is reachable", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto("/faq");
    await expect(page.getByRole("searchbox")).toBeHidden();
    await expect(page.locator("main details.faq-item")).toHaveCount(faqs.length);
    await ctx.close();
  });
});

test.describe("legal table of contents", () => {
  test("desktop: the open TOC lights the section being read and its links jump", async ({ page, isMobile }) => {
    test.skip(isMobile, "the TOC is a closed disclosure on phones (next test)");
    await page.goto("/privacy");
    const toc = page.getByRole("navigation", { name: "On this page" });
    const link = toc.getByRole("link", { name: "Cookies & analytics" });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/#cookies-and-analytics$/);
    await expect(page.getByRole("heading", { level: 2, name: "Cookies & analytics" })).toBeInViewport();
    await expect(link).toHaveAttribute("aria-current", "location");
  });

  test("phones: the TOC starts closed, opens on tap and closes after picking a section", async ({ page, isMobile }) => {
    test.skip(!isMobile, "phone layout");
    await page.goto("/terms");
    const toc = page.getByRole("navigation", { name: "On this page" });
    const link = toc.getByRole("link", { name: "Warranty" });
    await expect(link).toBeHidden();
    await toc.getByText("On this page").tap();
    await expect(link).toBeVisible();
    await link.tap();
    await expect(page).toHaveURL(/#warranty$/);
    await expect(link).toBeHidden();
    await expect(page.getByRole("heading", { level: 2, name: "Warranty" })).toBeInViewport();
  });
});

test.describe("gallery filter pill", () => {
  test("only the active category carries the lit pill that morphs between pages", async ({ page }) => {
    for (const [path, label] of [
      ["/gallery", "All"],
      ["/gallery/repairs", "Repairs"],
    ] as const) {
      await page.goto(path);
      const tabs = page.getByRole("navigation", { name: "Gallery categories" });
      await expect(tabs.locator(".tab-pill")).toHaveCount(1);
      const active = tabs.locator('a[aria-current="page"]');
      await expect(active).toHaveText(new RegExp(`^\\s*${label}\\b`));
      await expect(active.locator(".tab-pill")).toHaveCount(1);
      expect(await active.locator(".tab-pill").evaluate((el) => getComputedStyle(el).getPropertyValue("view-transition-name"))).toBe("gallery-pill");
      // the active pill is scrolled into the visible part of the bar (matters on phones)
      await expect(active).toBeInViewport();
    }
  });
});
