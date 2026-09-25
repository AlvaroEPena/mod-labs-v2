/** J1 Book a mod (spec §4) + negative paths for the /book form. */
import { test, expect, waitForFormReady, waitForTurnstileToken } from "./fixtures";

const OLED = /Switch OLED modchip, Kamikaze/;

test.describe("J1 book a service", () => {
  test("home → Book a service → submit Switch OLED booking shows inline success without navigation", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "Book a service" }).first().click();
    await expect(page).toHaveURL(/\/book$/);
    await waitForFormReady(page, "book");

    const form = page.locator("form#book");
    await form.getByRole("checkbox", { name: OLED }).check();
    await form.getByLabel("Your name").fill("Jamie Tester");
    await form.getByLabel("Email", { exact: true }).fill("jamie@example.com");
    await form.getByRole("radio", { name: /Mail-in \(let's talk\)/ }).check();
    await form.getByLabel("Message", { exact: true }).fill("OLED, white joy-cons. Would like to mail it in next week.");
    await form.getByRole("checkbox", { name: /OK to contact me/ }).check();

    // a marker on window proves there was no full page load
    await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
    await waitForTurnstileToken(page, "book");

    const apiResponse = page.waitForResponse((r) => r.url().endsWith("/api/book") && r.request().method() === "POST");
    await form.getByRole("button", { name: "Send booking request" }).click();
    const res = await apiResponse;
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });

    await expect(page.getByRole("heading", { name: "Request sent!" })).toBeVisible();
    await expect(form).toBeHidden();
    await expect(page).toHaveURL(/\/book$/);
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
    // success panel receives focus for screen-reader users
    await expect(page.locator("[data-success]")).toBeFocused();
  });

  test("submitting the empty form shows inline errors, focuses the first invalid field and makes no request", async ({ page }) => {
    const apiCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/")) apiCalls.push(r.url());
    });
    await page.goto("/book");
    await waitForFormReady(page, "book");
    const form = page.locator("form#book");
    await form.getByRole("button", { name: "Send booking request" }).click();

    await expect(form.locator('[data-error-for="services"]')).toHaveText("Select at least one service.");
    await expect(form.locator('[data-error-for="name"]')).not.toBeEmpty();
    await expect(form.locator('[data-error-for="email"]')).not.toBeEmpty();
    await expect(form.locator('[data-error-for="message"]')).not.toBeEmpty();
    await expect(form.locator('[data-error-for="consent"]')).not.toBeEmpty();
    await expect(form.getByLabel("Your name")).toHaveAttribute("aria-invalid", "true");
    await expect(form.getByRole("status")).toContainText(/./);

    // first invalid control in DOM order is the first service checkbox
    const first = form.getByRole("checkbox", { name: /Xbox 360 RGH/ });
    await expect(first).toBeFocused();
    expect(apiCalls).toEqual([]);
  });

  test("an invalid email and a short message are rejected client-side; fixing a field clears its error", async ({ page }) => {
    await page.goto("/book");
    await waitForFormReady(page, "book");
    const form = page.locator("form#book");
    await form.getByRole("checkbox", { name: OLED }).check();
    await form.getByLabel("Your name").fill("Jamie");
    await form.getByLabel("Email", { exact: true }).fill("not-an-email");
    await form.getByLabel("Message", { exact: true }).fill("too short");
    await form.getByRole("checkbox", { name: /OK to contact me/ }).check();
    await form.getByRole("button", { name: "Send booking request" }).click();

    await expect(form.locator('[data-error-for="email"]')).toHaveText("Please enter a valid email address.");
    await expect(form.locator('[data-error-for="message"]')).toContainText("at least 20 characters");
    await expect(form.getByLabel("Email", { exact: true })).toBeFocused();

    await form.getByLabel("Email", { exact: true }).fill("jamie@example.com");
    await expect(form.locator('[data-error-for="email"]')).toBeEmpty();
    await expect(form.getByLabel("Email", { exact: true })).not.toHaveAttribute("aria-invalid", "true");
  });

  test("/book?service=switch-oled pre-ticks the Switch OLED service", async ({ page }) => {
    await page.goto("/book?service=switch-oled");
    await waitForFormReady(page, "book");
    const form = page.locator("form#book");
    await expect(form.getByRole("checkbox", { name: OLED })).toBeChecked();
    await expect(form.getByRole("checkbox", { name: /Xbox 360 RGH/ })).not.toBeChecked();
  });

  test("an unknown ?service value pre-ticks nothing", async ({ page }) => {
    await page.goto("/book?service=nope");
    await waitForFormReady(page, "book");
    await expect(page.locator('form#book input[name="services"]:checked')).toHaveCount(0);
  });

  test("the services page 'Book' CTA for Switch OLED lands on a pre-ticked form", async ({ page }) => {
    await page.goto("/services");
    const link = page.locator('a[href="/book?service=switch-oled"]').first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/book\?service=switch-oled$/);
    await expect(page.locator("form#book").getByRole("checkbox", { name: OLED })).toBeChecked();
  });
});
