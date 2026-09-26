import { defineConfig, devices } from "@playwright/test";

const PORT = 8788;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // --local-upstream: wrangler.jsonc routes the Worker to modlabs.store, and without it wrangler dev
    // rewrites the request host to that domain, so the Worker would refuse log mode (localhost only).
    // Built site + Worker API with Turnstile test keys and no Resend key (emails are logged, not sent)
    command: `npm run build && npx wrangler dev --port ${PORT} --local-upstream localhost:${PORT} --var EMAIL_MODE:log --var TURNSTILE_SECRET_KEY:1x0000000000000000000000000000000AA`,
    url: `http://localhost:${PORT}`,
    // Real env vars beat .env.production, so e2e builds always use Turnstile TEST keys and a local URL.
    env: { PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA", PUBLIC_SITE_URL: "https://mod-labs.example" },
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
  },
});
