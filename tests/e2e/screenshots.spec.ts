/**
 * Every page's full-length screenshot (desktop + mobile) into the OS temp dir for the visual check.
 * Full-page captures use reduced motion: scroll-driven reveals are tied to the viewport, so with motion
 * on, everything below the fold would be captured mid-reveal (blank). The fold shot keeps motion on.
 */
import path from "node:path";
import { test, expect, SCREENSHOT_DIR, scrollThrough, ROUTES, NOT_FOUND_PATH } from "./fixtures";
import type { Page } from "@playwright/test";

const PAGES = [...ROUTES, NOT_FOUND_PATH];
const nameFor = (project: string, route: string) => `${project}-${route === "/" ? "home" : route.slice(1).replace(/\//g, "_")}`;

/** scroll through so lazy images load, waiting for each visible frame to un-blur */
async function loadAllImages(page: Page) {
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
}

for (const route of PAGES) {
  test(`screenshot ${route}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const name = nameFor(testInfo.project.name, route);
    await page.goto(route);
    await loadAllImages(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}-fold.png`) });

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
  });
}
