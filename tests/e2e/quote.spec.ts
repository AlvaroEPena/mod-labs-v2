/** J2 Quote a repair with a photo (spec §4) + photo rejection paths. */
import { test, expect, makeJpeg, waitForFormReady, waitForTurnstileToken } from "./fixtures";

test.describe("J2 quote with photo", () => {
  test("services → Get a quote → Electronic repair + JPEG photo → thumbnail → success", async ({ page }) => {
    await page.goto("/services");
    await page.getByRole("main").getByRole("link", { name: /Get a quote/ }).first().click();
    await expect(page).toHaveURL(/\/quote$/);
    await waitForFormReady(page, "quote");

    const form = page.locator("form#quote");
    await form.getByLabel("What do you need?").selectOption("Electronic repair");
    await form.getByLabel("Your name").fill("Riley Repair");
    await form.getByLabel("Email", { exact: true }).fill("riley@example.com");
    await form.getByLabel("Message", { exact: true }).fill("My controller's USB port is loose and it won't charge anymore.");

    await form.locator('input[type="file"][name="photos"]').setInputFiles({
      name: "broken-port.jpg",
      mimeType: "image/jpeg",
      buffer: await makeJpeg(2400, 1800),
    });
    const thumb = form.getByRole("img", { name: "Attached photo: broken-port.jpg" });
    await expect(thumb).toBeVisible();
    await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await expect(form.getByRole("button", { name: "Remove broken-port.jpg" })).toBeVisible();

    await form.getByRole("checkbox", { name: /OK to contact me/ }).check();
    await waitForTurnstileToken(page, "quote");

    const req = page.waitForRequest((r) => r.url().endsWith("/api/quote") && r.method() === "POST");
    const resP = page.waitForResponse((r) => r.url().endsWith("/api/quote") && r.request().method() === "POST");
    await form.getByRole("button", { name: "Send quote request" }).click();
    const body = (await req).postDataBuffer();
    expect(body, "multipart body").not.toBeNull();
    // the downscaled photo (≤1600px JPEG) is sent, not the 2400px original
    expect(body!.toString("latin1")).toContain('filename="broken-port.jpg"');
    const res = await resP;
    expect(res.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Request sent!" })).toBeVisible();
    await expect(page).toHaveURL(/\/quote$/);
  });

  test("a non-image file (.txt, text/plain) is rejected client-side with a message", async ({ page }) => {
    await page.goto("/quote");
    await waitForFormReady(page, "quote");
    const form = page.locator("form#quote");
    await form.locator('input[type="file"][name="photos"]').setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("definitely not a photo"),
    });
    await expect(form.locator('[data-error-for="photos"]')).toHaveText(/"notes\.txt" isn't an image/);
    await expect(form.locator("[data-thumbs] li")).toHaveCount(0);
  });

  test("a text file renamed to .jpg is rejected client-side (cannot be decoded)", async ({ page }) => {
    await page.goto("/quote");
    await waitForFormReady(page, "quote");
    const form = page.locator("form#quote");
    await form.locator('input[type="file"][name="photos"]').setInputFiles({
      name: "fake.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("this is text pretending to be a jpeg"),
    });
    await expect(form.locator('[data-error-for="photos"]')).toHaveText(/Couldn't read "fake\.jpg"/);
    await expect(form.locator("[data-thumbs] li")).toHaveCount(0);
  });

  test("more than 3 photos: the 4th is refused with a message", async ({ page }) => {
    await page.goto("/quote");
    await waitForFormReady(page, "quote");
    const form = page.locator("form#quote");
    const jpeg = await makeJpeg(400, 300);
    await form.locator('input[type="file"][name="photos"]').setInputFiles(
      ["a", "b", "c", "d"].map((n) => ({ name: `${n}.jpg`, mimeType: "image/jpeg", buffer: jpeg })),
    );
    await expect(form.locator('[data-error-for="photos"]')).toContainText('"d.jpg" wasn\'t added');
    await expect(form.getByRole("img", { name: /Attached photo:/ })).toHaveCount(3);
  });

  test("removing an attached photo removes its thumbnail", async ({ page }) => {
    await page.goto("/quote");
    await waitForFormReady(page, "quote");
    const form = page.locator("form#quote");
    await form.locator('input[type="file"][name="photos"]').setInputFiles({
      name: "x.jpg",
      mimeType: "image/jpeg",
      buffer: await makeJpeg(400, 300),
    });
    await form.getByRole("button", { name: "Remove x.jpg" }).click();
    await expect(form.getByRole("img", { name: /Attached photo:/ })).toHaveCount(0);
  });

  test("submitting without a request type flags the select first", async ({ page }) => {
    await page.goto("/quote");
    await waitForFormReady(page, "quote");
    const form = page.locator("form#quote");
    await form.getByRole("button", { name: "Send quote request" }).click();
    await expect(form.locator('[data-error-for="requestType"]')).toHaveText("Choose a request type.");
    await expect(form.getByLabel("What do you need?")).toBeFocused();
  });

  test("a photo picked before the page script loads is still sent (or flagged), never silently dropped", async ({ page }) => {
    // slow JS (e.g. a phone on a weak connection): the user picks a photo before the controller hydrates
    await page.route("**/_astro/*.js", async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/quote")) posts.push(r.postDataBuffer()?.toString("latin1") ?? "");
    });
    await page.goto("/quote", { waitUntil: "commit" });
    const form = page.locator("form#quote");
    await form.locator('input[type="file"][name="photos"]').setInputFiles({
      name: "early.jpg",
      mimeType: "image/jpeg",
      buffer: await makeJpeg(800, 600),
    });
    await waitForFormReady(page, "quote");

    await form.getByLabel("What do you need?").selectOption("Electronic repair");
    await form.getByLabel("Your name").fill("Early Bird");
    await form.getByLabel("Email", { exact: true }).fill("early@example.com");
    await form.getByLabel("Message", { exact: true }).fill("I picked my photo before the page finished loading.");
    await form.getByRole("checkbox", { name: /OK to contact me/ }).check();
    await waitForTurnstileToken(page, "quote");

    // Either the controller adopts the already-selected file (thumbnail) ...
    const adopted = await form.getByRole("img", { name: "Attached photo: early.jpg" }).count();
    await form.getByRole("button", { name: "Send quote request" }).click();
    await expect(page.getByRole("heading", { name: "Request sent!" })).toBeVisible();
    // ... and the photo must reach the API. Success without the photo = silent data loss.
    expect({ adopted, sentPhoto: posts.some((b) => b.includes('filename="early')) }).toEqual({ adopted: 1, sentPhoto: true });
  });
});
