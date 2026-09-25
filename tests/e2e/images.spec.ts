/**
 * Images actually load and leave their blurred LQIP placeholder (.ph → .ph.is-loaded),
 * checked at every scroll position for images in or near the viewport.
 */
import { test, expect, scrollThrough } from "./fixtures";

type ImgState = { src: string; complete: boolean; natural: number; loaded: boolean; opacity: string };

/** images whose box intersects the viewport extended by `margin` px */
const nearViewportImages = (margin: number) =>
  Array.from(document.querySelectorAll<HTMLImageElement>("main img")).flatMap((img): ImgState[] => {
    const r = img.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return [];
    const near =
      r.bottom > -margin && r.top < innerHeight + margin && r.right > 0 && r.left < innerWidth;
    if (!near) return [];
    const frame = img.closest(".ph");
    return [
      {
        src: (img.currentSrc || img.src).split("/").pop() ?? "",
        complete: img.complete,
        natural: img.naturalWidth,
        loaded: frame ? frame.classList.contains("is-loaded") : true,
        opacity: getComputedStyle(img).opacity,
      },
    ];
  });

for (const route of ["/", "/builds", "/gallery/custom"]) {
  test(`every in-view image on ${route} loads and un-blurs while scrolling`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(route);
    let checked = 0;
    await scrollThrough(page, async (y) => {
      await expect
        .poll(
          async () => {
            const imgs = await page.evaluate(nearViewportImages, 0);
            checked = Math.max(checked, imgs.length);
            return imgs.filter((i) => !i.complete || i.natural === 0 || !i.loaded || i.opacity !== "1");
          },
          { timeout: 10_000, message: `images still loading/blurred at scrollY=${y}` },
        )
        .toEqual([]);
    });
    expect(checked, "at least one image was checked").toBeGreaterThan(0);
  });
}

test("home build cards are un-blurred after scrolling to them (full-page screenshot concern)", async ({ page }) => {
  await page.goto("/");
  const cards = page.locator("article.build .ph");
  await expect(cards).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await cards.nth(i).scrollIntoViewIfNeeded();
    await expect(cards.nth(i)).toHaveClass(/is-loaded/);
    await expect(cards.nth(i).locator("img")).toHaveJSProperty("complete", true);
  }
});

test("offscreen gallery images are lazy (not requested before scrolling)", async ({ page }) => {
  await page.goto("/gallery/custom");
  const lazyCount = await page.locator('main img[loading="lazy"]').count();
  expect(lazyCount).toBeGreaterThan(10);
  // the last tile on the page should not have loaded yet
  const last = page.locator("main .gl-tile img").last();
  expect(await last.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(false);
});

test("Halo video: preload=none, has a poster, and the mp4 is served", async ({ page, request }) => {
  await page.goto("/gallery/custom");
  const video = page.locator("video");
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute("preload", "none");
  const poster = await video.getAttribute("poster");
  expect(poster).toBeTruthy();
  expect((await request.get(poster!)).status()).toBe(200);
  const src = await video.locator("source").getAttribute("src");
  expect(src).toBe("/media/halo-xbox.mp4");
  const res = await request.get("/media/halo-xbox.mp4");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("video/mp4");
  await expect(video).toHaveAttribute("aria-label", /Halo/);
});

test("every <img> has alt text on image-heavy routes", async ({ page }) => {
  for (const route of ["/", "/builds", "/gallery"]) {
    await page.goto(route);
    const missing = await page.$$eval("img", (imgs) => imgs.filter((i) => !i.hasAttribute("alt")).map((i) => i.src));
    expect(missing, `${route} images without alt`).toEqual([]);
  }
});
