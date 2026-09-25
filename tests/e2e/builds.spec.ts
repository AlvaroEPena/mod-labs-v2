/** J3 Commission a build (spec §4). */
import { test, expect, waitForFormReady, waitForTurnstileToken } from "./fixtures";

const BUILDS = [
  { slug: "gwii", heading: "GWii", requestType: "Custom build commission: GWii ($900)" },
  { slug: "wii-miicro", heading: /Wii Miicro/, requestType: "Custom build commission: Wii Miicro Deluxe ($450)" },
] as const;

for (const b of BUILDS) {
  test(`J3 /builds → ${b.slug} "Request this build" → /quote?build=${b.slug} preselected → submit succeeds`, async ({ page }) => {
    await page.goto("/builds");
    const section = page.locator(`section#${b.slug}`);
    await expect(section.getByRole("heading", { level: 2, name: b.heading })).toBeVisible();
    await section.getByRole("link", { name: /Request this build/ }).click();
    await expect(page).toHaveURL(new RegExp(`/quote\\?build=${b.slug}$`));

    await waitForFormReady(page, "quote");
    const form = page.locator("form#quote");
    await expect(form.getByLabel("What do you need?")).toHaveValue(b.requestType);

    await form.getByLabel("Your name").fill("Casey Collector");
    await form.getByLabel("Email", { exact: true }).fill("casey@example.com");
    await form.getByLabel("Message", { exact: true }).fill(`I'd love to commission the ${b.slug} build. Timeline flexible.`);
    await form.getByRole("checkbox", { name: /OK to contact me/ }).check();
    await waitForTurnstileToken(page, "quote");

    const res = page.waitForResponse((r) => r.url().endsWith("/api/quote") && r.request().method() === "POST");
    await form.getByRole("button", { name: "Send quote request" }).click();
    expect((await res).status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Request sent!" })).toBeVisible();
  });
}

test("J3 home featured build → /builds GWii section", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /See the build.*GWii/ }).click();
  await expect(page).toHaveURL(/\/builds#gwii$/);
  await expect(page.locator("section#gwii").getByRole("heading", { level: 2 })).toBeInViewport();
});

test("/quote?build=unknown leaves the request type unselected", async ({ page }) => {
  await page.goto("/quote?build=unknown");
  await waitForFormReady(page, "quote");
  await expect(page.locator("form#quote").getByLabel("What do you need?")).toHaveValue("");
});
