/** J5 Learn & trust (spec §4): FAQ accordion by keyboard, mobile menu. */
import { test, expect } from "./fixtures";

test.describe("J5 FAQ + navigation", () => {
  test("home FAQ teaser → /faq; accordion opens and closes with the keyboard", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /All questions/ }).click();
    await expect(page).toHaveURL(/\/faq$/);

    const items = page.locator("main details.faq-item");
    expect(await items.count()).toBeGreaterThan(3);
    const item = items.nth(1);
    const summary = item.locator("summary");
    await expect(item).not.toHaveAttribute("open");

    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(item).toHaveAttribute("open", "");
    await expect(item.locator(".faq-answer")).toBeVisible();

    await page.keyboard.press("Space");
    await expect(item).not.toHaveAttribute("open");
    await expect(item.locator(".faq-answer")).toBeHidden();
  });

  test("FAQ summaries are reachable with Tab", async ({ page }) => {
    await page.goto("/faq");
    const first = page.locator("main details.faq-item summary").first();
    // tab until the first summary gets focus (bounded)
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      if (await first.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(first).toBeFocused();
  });

  test("mobile menu opens, closes with Esc, and its links navigate (About)", async ({ page, isMobile }) => {
    test.skip(!isMobile, "the burger menu is only shown below 1024px");
    await page.goto("/");
    const burger = page.getByRole("button", { name: "Menu" });
    const menu = page.locator("#mobile-menu");
    await expect(burger).toBeVisible();

    await burger.tap();
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("link", { name: "Services" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    await burger.tap();
    await expect(menu).toBeVisible();
    await menu.getByRole("link", { name: "About" }).tap();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.locator("#mobile-menu")).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("desktop main nav reaches every section", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop nav is hidden below 1024px");
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const [label, path] of [
      ["Services", "/services"],
      ["Builds", "/builds"],
      ["Gallery", "/gallery"],
      ["About", "/about"],
      ["FAQ", "/faq"],
    ] as const) {
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label, exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
  });

  test("skip link moves focus to main content", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard-only check");
    await page.goto("/about");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });
});
