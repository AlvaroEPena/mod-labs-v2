// Refuses to deploy a build that would break production (see README "Deploy checklist").
// Runs before `wrangler deploy` via `npm run deploy`, and before every Cloudflare Workers Builds
// build via the `prebuild` npm hook (`--ci-only`: a no-op unless WORKERS_CI is set, so local
// builds and e2e runs with test keys keep working).
import fs from "node:fs";
import path from "node:path";

if (process.argv.includes("--ci-only") && !process.env.WORKERS_CI) process.exit(0);

const root = path.resolve(import.meta.dirname, "..");

// Astro loads .env files at build time; mirror that so the check sees the same values.
function readEnvFile(name) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => /^\s*[A-Z_][A-Z0-9_]*\s*=/.test(l))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
}
const env = { ...readEnvFile(".env"), ...readEnvFile(".env.production"), ...process.env };

const problems = [];
const siteUrl = env.PUBLIC_SITE_URL ?? "";
const siteKey = env.PUBLIC_TURNSTILE_SITE_KEY ?? "";

if (!siteUrl || /^https:\/\/mod-labs\.workers\.dev\/?$/.test(siteUrl) || /localhost|127\.0\.0\.1/.test(siteUrl)) {
  problems.push(
    `PUBLIC_SITE_URL is "${siteUrl || "(unset)"}". Set it to the real address, e.g. https://mod-labs.<your-subdomain>.workers.dev or your custom domain.`,
  );
}
if (!siteKey || /^[123]x0000/.test(siteKey)) {
  problems.push(
    `PUBLIC_TURNSTILE_SITE_KEY is ${siteKey ? "Cloudflare's TEST key" : "unset"}. Use the real site key from your Turnstile widget.`,
  );
}

// Double-check the built output, in case the build ran with different env.
const dist = path.join(root, "dist");
if (fs.existsSync(dist)) {
  const quote = path.join(dist, "quote.html");
  if (fs.existsSync(quote) && /data-sitekey="[123]x0000/.test(fs.readFileSync(quote, "utf8"))) {
    problems.push("dist/quote.html was built with a TEST Turnstile key. Rebuild with the real key.");
  }
  const home = path.join(dist, "index.html");
  const canonical = fs.existsSync(home) ? fs.readFileSync(home, "utf8").match(/rel="canonical" href="([^"]+)"/)?.[1] : undefined;
  if (canonical && siteUrl && !canonical.startsWith(siteUrl.replace(/\/$/, ""))) {
    problems.push(`dist/index.html canonical is ${canonical}, expected ${siteUrl}. Rebuild.`);
  }
}

if (problems.length) {
  console.error("\n✖ Deploy blocked:\n  - " + problems.join("\n  - ") + "\n");
  process.exit(1);
}
console.log("✓ Pre-deploy checks passed:", siteUrl);
