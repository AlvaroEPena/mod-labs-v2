/** Key-page screenshots (desktop + mobile) into the OS temp dir for the visual check. */
import path from "node:path";
import { test, expect, SCREENSHOT_DIR, scrollThrough } from "./fixtures";

const PAGES = ["/", "/services", "/builds", "/gallery", "/book", "/quote", "/faq", "/this-page-does-not-exist"];

for (const route of PAGES) {
  test(`screenshot ${route}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.goto(route);
    // scroll through so lazy images load, waiting for each visible frame to un-blur
    await scrollThrough(page, async () => {
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              Array.from(document.querySelectorAll(".ph:not(.is-loaded)")).filter((f) => {
                const r = f.getBoundingClientRect();
                return r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
              }).length,
          ),
        )
        .toBe(0);
    });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    const name = `${testInfo.project.name}-${route === "/" ? "home" : route.slice(1).replace(/\//g, "_")}`;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}-fold.png`) });
  });
}
