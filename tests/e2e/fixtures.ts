/**
 * Shared Playwright fixtures + helpers for the Mod Labs e2e suite.
 *
 * Rate limiting: the Worker allows 5 form POSTs / 60 s per CF-Connecting-IP. Locally
 * (wrangler dev) every request comes from the same IP, so a full run would trip the limiter.
 * Real Cloudflare overwrites CF-Connecting-IP, but wrangler dev honours a client-supplied one,
 * so each test gets its own fake client IP on /api/* requests (browser + request fixture).
 * The rate limiter itself is covered by a dedicated test in api.spec.ts.
 */
import { test as base, expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

/** A per-test fake client IP (random 10.x.y.z: ~16M values, so workers don't collide in practice). */
export function freshIp(): string {
  const [a, b, c] = randomBytes(3);
  return `10.${a}.${b}.${(c % 254) + 1}`;
}

type Fixtures = { clientIp: string };

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires object destructuring here
  clientIp: async ({}, use) => {
    await use(freshIp());
  },
  page: async ({ page, clientIp }, use) => {
    await page.route("**/api/**", async (route) => {
      await route.continue({ headers: { ...route.request().headers(), "cf-connecting-ip": clientIp } });
    });
    await use(page);
  },
});

export { expect };

/** Every public route from spec §3 (404 is exercised via an unknown path). */
export const ROUTES = [
  "/",
  "/services",
  "/builds",
  "/gallery",
  "/gallery/switch",
  "/about",
  "/book",
  "/quote",
  "/faq",
  "/privacy",
  "/terms",
] as const;
export const NOT_FOUND_PATH = "/this-page-does-not-exist";
export const GALLERY_CATEGORIES = ["switch", "xbox", "playstation", "custom", "repairs"] as const;

export const SCREENSHOT_DIR = path.join(os.tmpdir(), "mod-labs-qa-screens");

/** A real JPEG generated in memory (no checked-in binary fixture). */
export async function makeJpeg(width = 1200, height = 900): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 0, g: 170, b: 220 } } })
    .jpeg({ quality: 80 })
    .toBuffer();
}

/** Wait for the Turnstile widget (Cloudflare always-pass test key) to write its token into the form. */
export async function waitForTurnstileToken(page: Page, formId: "book" | "quote") {
  await expect
    .poll(
      () =>
        page.evaluate(
          (id) => (document.querySelector<HTMLInputElement>(`#${id} [name="cf-turnstile-response"]`)?.value ?? ""),
          formId,
        ),
      { timeout: 20_000, message: "Turnstile never produced a token" },
    )
    .not.toBe("");
}

/** The form controller sets form.noValidate once it has enhanced the form (listeners attached). */
export async function waitForFormReady(page: Page, formId: "book" | "quote") {
  await page.waitForFunction((id) => document.querySelector<HTMLFormElement>(`form#${id}`)?.noValidate === true, formId);
}

/**
 * PhotoSwipe drops keys/gestures/close() that arrive during its ~320 ms opening transition, so wait
 * until the dialog is shown AND no CSS transition/animation inside it is still running.
 */
export async function waitForLightboxOpen(page: Page) {
  await expect(page.locator(".pswp.pswp--open.pswp--ui-visible")).toBeVisible();
  await page.waitForFunction(() => {
    const root = document.querySelector(".pswp");
    if (!root) return false;
    return document.getAnimations().every((a) => {
      const effect = a.effect as KeyframeEffect | null;
      const target = effect?.target;
      if (!(target instanceof Node && root.contains(target))) return true;
      // ignore the infinite preloader spinner; only the finite opening transitions matter
      return effect?.getTiming().iterations === Infinity || a.playState !== "running";
    });
  });
}

/** Render every content-visibility:auto section once (scroll to the bottom and back, frame by frame). */
export async function renderWholePage(page: Page) {
  await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight) {
      window.scrollTo({ top: y, behavior: "instant" });
      await frame();
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    await frame();
  });
}

/**
 * Scroll the whole page in ~viewport-sized steps and run `atEachStep` at every position
 * (callers assert/poll there, so there are no fixed sleeps).
 */
export async function scrollThrough(page: Page, atEachStep: (y: number) => Promise<void>) {
  const vh = page.viewportSize()?.height ?? 800;
  for (let y = 0; ; y += Math.floor(vh * 0.8)) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (y >= height) break;
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
    await atEachStep(y);
  }
}

/** Collect CSP violations reported by the page (securitypolicyviolation events + console errors). */
export async function trackCsp(page: Page) {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`Refused to load (CSP ${e.violatedDirective}): ${e.blockedURI}`);
    });
  });
  return violations;
}
