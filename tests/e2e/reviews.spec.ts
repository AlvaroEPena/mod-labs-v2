/**
 * Reviews (spec §17): the static empty state, the review form contract, the star picker (keyboard + touch),
 * client validation, the UI for every ApiResult code, and real submissions to the Worker.
 * API outcomes are mocked with page.route so the UI is proven independently of the database.
 */
import type { Page } from "@playwright/test";
import { test, expect, waitForFormReady, waitForTurnstileToken } from "./fixtures";
import { reviewFields as F, renderReviewItem } from "../../src/lib/reviews/contract";
import { reviewCopy } from "../../src/scripts/forms/messages";
import { RATING_PROMPT } from "../../src/scripts/forms/rating";

const form = (page: Page) => page.locator("form#review");
const star = (page: Page, n: number) => form(page).getByRole("radio", { name: new RegExp(`^${n} stars?:`) });

async function fillValidReview(page: Page) {
  const f = form(page);
  await f.getByLabel("Your name").fill("Robin K.");
  await f.locator(`label[for="review-rating-4"]`).click();
  await f.getByLabel(/What did I work on/).selectOption("Switch OLED");
  await f.getByLabel(/How did you find us/).selectOption("Google");
  await f.getByLabel("Your review").fill("Dropped my OLED off in the morning and it was ready that evening. Clear explanation too.");
  await f.getByRole("checkbox", { name: /shown publicly on this site/ }).check();
}

async function openForm(page: Page) {
  await page.goto("/reviews");
  await waitForFormReady(page, "review");
}

test.describe("reviews page (static)", () => {
  test("ships the empty state: invitation shown, review wall hidden, Write a review jumps to the form", async ({ page }) => {
    await page.goto("/reviews");
    await expect(page.getByText("No reviews yet")).toBeVisible();
    await expect(page.locator('[data-reviews-slot="all"]')).toBeHidden();
    for (const el of await page.locator("[data-reviews-when-any]").all()) await expect(el).toBeHidden();
    await page.getByRole("link", { name: /Write a review/ }).click();
    await expect(page).toHaveURL(/#write$/);
    await expect(page.getByRole("heading", { level: 2, name: "Write a review" })).toBeInViewport();
  });

  test("the home page invites the first review and links to the form", async ({ page }) => {
    await page.goto("/");
    const invite = page.locator("[data-reviews-when-empty]");
    await expect(invite).toBeVisible();
    await expect(page.locator('[data-reviews-slot="home"]')).toBeHidden();
    await invite.getByRole("link", { name: /Leave a review/ }).click();
    await expect(page).toHaveURL(/\/reviews#write$/);
  });

  test("injected review markup is styled by the global review CSS (lit vs dim stars)", async ({ page }) => {
    await page.goto("/");
    const html = renderReviewItem({ name: "Layout Check", rating: 3, service: "Repair", source: "Google", body: "Markup check only.", approvedAt: 0 });
    const [on, off] = await page.evaluate((item) => {
      document.querySelectorAll("[data-reviews-when-any]").forEach((e) => ((e as HTMLElement).hidden = false));
      const ul = document.querySelector('[data-reviews-slot="home"]')!;
      ul.innerHTML = item;
      const stars = ul.querySelectorAll<HTMLElement>(".star");
      return [getComputedStyle(stars[0]).backgroundImage, getComputedStyle(stars[4]).backgroundImage];
    }, html);
    expect(on).toContain("gradient");
    expect(off).not.toContain("gradient");
    await expect(page.locator(".review-card .review-source")).toHaveText("Found us on Google");
  });

  test("the form posts multipart to /api/review with exactly the contract's fields, in order", async ({ page }) => {
    await page.goto("/reviews");
    const f = form(page);
    await expect(f).toHaveAttribute("action", "/api/review");
    await expect(f).toHaveAttribute("method", "post");
    await expect(f).toHaveAttribute("enctype", "multipart/form-data");
    const names = await f.evaluate((el) => [...new Set(Array.from(el.querySelectorAll("[name]"), (c) => c.getAttribute("name")))]);
    expect(names).toEqual([F.name, F.rating, F.service, F.source, F.body, F.consent, F.honeypot]);
    await expect(f.locator('[data-turnstile][data-action="review"]')).toHaveCount(1);
    await expect(f.locator(`input[name="${F.consent}"]`)).toHaveAttribute("value", "yes");
    await expect(f.locator(`input[name="${F.rating}"]`)).toHaveCount(5);
  });
});

test.describe("star picker", () => {
  test("keyboard: Tab enters the group, Space picks, arrows move the rating, and the readout follows", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard-only check");
    await openForm(page);
    const readout = form(page).locator("[data-star-text]");
    await expect(readout).toHaveText(RATING_PROMPT);
    await form(page).getByLabel("Your name").focus();
    await page.keyboard.press("Tab");
    await expect(star(page, 1)).toBeFocused();
    await page.keyboard.press("Space");
    await expect(star(page, 1)).toBeChecked();
    await expect(readout).toHaveText("1 out of 5: Poor");
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await expect(star(page, 4)).toBeChecked();
    await expect(star(page, 4)).toBeFocused();
    await expect(readout).toHaveText("4 out of 5: Great");
    await page.keyboard.press("ArrowLeft");
    await expect(star(page, 3)).toBeChecked();
    await expect(form(page).getByRole("radio", { checked: true })).toHaveCount(1);
    // one Tab leaves the group (it's a single stop, like any radio group)
    await page.keyboard.press("Tab");
    await expect(form(page).getByLabel(/What did I work on/)).toBeFocused();
  });

  test("tap/click: picking a star lights it and every star before it, and only those", async ({ page, isMobile }) => {
    await openForm(page);
    const pick = async (n: number) => {
      const label = form(page).locator(`label[for="review-rating-${n}"]`);
      if (isMobile) await label.tap();
      else await label.click();
      await expect(star(page, n)).toBeChecked();
    };
    const colours = () => form(page).locator("label.star").evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
    await pick(5);
    await expect.poll(async () => new Set(await colours()).size).toBe(1);
    await pick(2);
    await expect
      .poll(async () => {
        const c = await colours();
        return [c[0] === c[1], c[1] !== c[2], c[2] === c[4]];
      })
      .toEqual([true, true, true]);
    await expect(form(page).locator("[data-star-text]")).toHaveText("2 out of 5: Fair");
  });

  test("every star is at least 44px for thumbs", async ({ page }) => {
    await openForm(page);
    for (const box of await form(page).locator("label.star").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("review form validation", () => {
  test("an empty submit flags name, rating, review and consent, focuses the name, and sends nothing", async ({ page }) => {
    const apiCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/")) apiCalls.push(r.url());
    });
    await openForm(page);
    const f = form(page);
    await f.getByRole("button", { name: "Send my review" }).click();
    await expect(f.locator('[data-error-for="name"]')).not.toBeEmpty();
    await expect(f.locator('[data-error-for="rating"]')).toHaveText("Choose a star rating.");
    await expect(f.locator('[data-error-for="body"]')).not.toBeEmpty();
    await expect(f.locator('[data-error-for="consent"]')).not.toBeEmpty();
    await expect(star(page, 1)).toHaveAttribute("aria-invalid", "true");
    await expect(f.getByLabel("Your name")).toBeFocused();
    await expect(f.getByRole("status")).toHaveText("4 fields need attention: Name, Rating, Review, Consent.");
    // picking a rating clears its error
    await f.locator('label[for="review-rating-5"]').click();
    await expect(f.locator('[data-error-for="rating"]')).toBeEmpty();
    expect(apiCalls).toEqual([]);
  });

  test("the counter follows typing, and a review with a link is refused before sending", async ({ page }) => {
    await openForm(page);
    const f = form(page);
    await fillValidReview(page);
    const text = "Great work, I posted photos of it on example.com afterwards";
    await f.getByLabel("Your review").fill(text);
    await expect(f.locator('[data-count-for="review-body"]')).toHaveText(String(text.length));
    await f.getByRole("button", { name: "Send my review" }).click();
    await expect(f.locator('[data-error-for="body"]')).toHaveText("Please leave links out of your review.");
    await expect(f.getByLabel("Your review")).toBeFocused();
  });
});

test.describe("review form API outcomes (mocked)", () => {
  const mock = (page: Page, status: number, body: unknown) =>
    page.route("**/api/review", (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }));

  test("success: multipart + JSON accept, approval-pending message, then a clean form for another", async ({ page }) => {
    await mock(page, 200, { ok: true, message: "Thanks" });
    await openForm(page);
    await fillValidReview(page);
    await waitForTurnstileToken(page, "review");
    const req = page.waitForRequest((r) => r.url().endsWith("/api/review") && r.method() === "POST");
    await form(page).getByRole("button", { name: "Send my review" }).click();
    const sent = await req;
    expect(sent.headers()["accept"]).toBe("application/json");
    expect(sent.headers()["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    const body = sent.postDataBuffer()!.toString("utf8");
    expect(body).toMatch(/name="rating"\r\n\r\n4\r\n/);
    expect(body).toMatch(/name="source"\r\n\r\nGoogle\r\n/);
    expect(body).toContain('name="cf-turnstile-response"');

    await expect(page.getByRole("heading", { name: "Thanks for the review!" })).toBeVisible();
    await expect(page.locator("[data-success-message]")).toHaveText(reviewCopy.success);
    await expect(page.locator("[data-success]")).toBeFocused();
    await expect(form(page)).toBeHidden();

    await page.getByRole("button", { name: "Write another review" }).click();
    await expect(form(page)).toBeVisible();
    await expect(form(page).getByLabel("Your name")).toHaveValue("");
    await expect(form(page).getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(form(page).locator("[data-star-text]")).toHaveText(RATING_PROMPT);
    await expect(form(page).locator('[data-count-for="review-body"]')).toHaveText("0");
  });

  test("server field errors are shown inline on the right field", async ({ page }) => {
    await mock(page, 400, { ok: false, error: "validation", fieldErrors: { body: ["Please leave links out of your review."] } });
    await openForm(page);
    await fillValidReview(page);
    await waitForTurnstileToken(page, "review");
    await form(page).getByRole("button", { name: "Send my review" }).click();
    await expect(form(page).locator('[data-error-for="body"]')).toHaveText("Please leave links out of your review.");
    await expect(form(page).getByRole("status")).toHaveText("1 field needs attention: Review.");
  });

  for (const [code, status] of [
    ["captcha", 403],
    ["rate_limited", 429],
    ["daily_limit", 429],
    ["too_large", 413],
    ["not_configured", 503],
    ["server", 500],
  ] as const) {
    test(`${code}: shows the review wording and keeps what was typed`, async ({ page }) => {
      await mock(page, status, { ok: false, error: code, message: "raw server text" });
      await openForm(page);
      await fillValidReview(page);
      await waitForTurnstileToken(page, "review");
      await form(page).getByRole("button", { name: "Send my review" }).click();
      await expect(form(page).getByRole("status")).toHaveText(reviewCopy.errors[code]);
      await expect(form(page).getByLabel("Your name")).toHaveValue("Robin K.");
      await expect(star(page, 4)).toBeChecked();
    });
  }

  test("daily_limit: tells the visitor to come back tomorrow, and the button comes back for later", async ({ page }) => {
    await mock(page, 429, { ok: false, error: "daily_limit", message: "raw server text" });
    await openForm(page);
    await fillValidReview(page);
    await waitForTurnstileToken(page, "review");
    const button = form(page).getByRole("button", { name: "Send my review" });
    await button.click();
    const status = form(page).getByRole("status");
    await expect(status).toHaveText(/try again tomorrow/);
    await expect(status).not.toHaveText(/minute/);
    await expect(status).toBeFocused();
    await expect(button).toBeEnabled();
  });

  test("a network failure is explained, and the button comes back", async ({ page }) => {
    await page.route("**/api/review", (route) => route.abort("internetdisconnected"));
    await openForm(page);
    await fillValidReview(page);
    await waitForTurnstileToken(page, "review");
    const button = form(page).getByRole("button", { name: "Send my review" });
    await button.click();
    await expect(form(page).getByRole("status")).toHaveText(reviewCopy.errors.network);
    await expect(button).toBeEnabled();
  });
});

test.describe("review form against the real Worker", () => {
  test("the browser form reaches /api/review and shows the Worker's JSON answer (honeypot path, stores nothing)", async ({ page }) => {
    // A filled honeypot makes the Worker answer success without storing or emailing anything, so this proves
    // the real multipart + JSON round trip without needing the database. The client ignores honeypot errors.
    await openForm(page);
    await fillValidReview(page);
    await page.locator(`#review-${F.honeypot}`).evaluate((el: HTMLInputElement) => (el.value = "bot"));
    await waitForTurnstileToken(page, "review");
    const res = page.waitForResponse((r) => r.url().endsWith("/api/review") && r.request().method() === "POST");
    await form(page).getByRole("button", { name: "Send my review" }).click();
    expect((await res).status()).toBe(200);
    expect(await (await res).json()).toMatchObject({ ok: true });
    await expect(page.getByRole("heading", { name: "Thanks for the review!" })).toBeVisible();
  });

  test("a real review is stored as pending and the visitor is told it appears once approved", async ({ page, request, clientIp }) => {
    // No Turnstile token: a configured Worker stops at the captcha check (403, nothing stored);
    // one without the database answers 503 not_configured before that.
    const probe = await request.post("/api/review", {
      headers: { Accept: "application/json", "CF-Connecting-IP": clientIp },
      multipart: { [F.name]: "Probe" },
    });
    test.fixme(
      probe.status() === 503,
      "/api/review answers not_configured locally: wrangler.jsonc has no reviews D1 binding / REVIEW_SIGNING_KEY for wrangler dev yet (backend agent, spec §17). Remove this once the local DB is wired.",
    );
    await openForm(page);
    await fillValidReview(page);
    await waitForTurnstileToken(page, "review");
    const res = page.waitForResponse((r) => r.url().endsWith("/api/review") && r.request().method() === "POST");
    await form(page).getByRole("button", { name: "Send my review" }).click();
    expect((await res).status()).toBe(200);
    await expect(page.locator("[data-success-message]")).toHaveText(reviewCopy.success);
  });
});
