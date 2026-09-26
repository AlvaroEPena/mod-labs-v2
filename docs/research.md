# Stack Research — Mod Labs (2026-09-24)

Archetype: **Static / brochure with a large image gallery + 2 forms**, commercial, zero budget.
All versions below were checked with `npm view` on 2026-09-24 unless marked *(unverified)*.

## Requirements that drive the choice

1. **Must be free and allowed for commercial use.** This is a business advertising paid services, so free tiers that forbid commercial use are out. Hosting and the form backend are the hardest layers.
2. **"No chunky loading" on phones.** Ship almost no JS. Build responsive AVIF/WebP images with correct `width`/`height` (no CLS). Lazy-load the gallery. Use a low-quality placeholder so tiles never flash empty.
3. **Big local photo gallery.** About 100–200 curated phone photos. Sources are about 4032×3024 JPEGs of 1–3 MB with EXIF orientation *and GPS* metadata (confirmed on `imgs/project3.2.jpg`: orientation=6, EXIF present). Needs a touch/swipe/pinch-zoom accessible lightbox.
4. **Premium neon motion** (glow, reveals, page transitions) with minimal JS. Must respect `prefers-reduced-motion`.
5. **Two forms that email the owner.** One takes a photo upload. AJAX submit, instant confirmation, spam protection, no credit card.
6. Content lives in code/data files. No CMS, DB, or auth. Dev machine is Windows 11, Node 24.21.0, npm 11.19.0 (checked locally).

## Recommendation

| Layer | Choice | Version | Why |
|---|---|---|---|
| Framework | **Astro** (static output, no adapter) | `astro` 7.3.5 (7.0.0 released 2026-06-22) | Zero-JS-by-default MPA. Build-time `<Picture>` makes AVIF/WebP + `srcset`/`sizes`, has a `priority` prop and inferred dimensions. Content collections suit the data files. Same framework the owner already knows. |
| Styling | **Tailwind CSS v4** via Vite plugin, plus a small hand-written `effects.css` (glows, keyframes, scroll timelines) | `tailwindcss` / `@tailwindcss/vite` 4.3.3 | CSS-first `@theme` tokens for the neon palette. Tiny purged CSS, high AI-buildability. Bespoke effects stay in plain modern CSS. Drop Bootstrap and AOS. |
| Fonts | Astro Fonts API (stable), self-hosted | built into astro 7.3.5 | Self-hosts and preloads the display font and generates metric-matched fallbacks, so no layout shift. |
| Motion | **Native CSS first**: cross-document View Transitions (`@view-transition`), scroll-driven animations inside `@supports`, and a ~1 KB IntersectionObserver reveal script for all browsers. **No GSAP/Motion at launch.** | n/a (platform) | Chrome 126+/Safari 18.2+ get page transitions and Firefox just navigates normally. Scroll timelines in Chrome 115+/Safari 26+ are an enhancement only. Everything is wrapped in `@media (prefers-reduced-motion: no-preference)`. |
| Lightbox | **PhotoSwipe 5**, loaded with dynamic `import()` on first tap | `photoswipe` 5.4.4 | Swipe, pinch-zoom, swipe-to-close, keyboard, focus handling. Measured gzipped: lightbox 4.5 KB + core 16.4 KB (lazy) + CSS 2.4 KB. Progressive: each thumb is an `<a href>` to the large image. |
| LQIP placeholders | Build-time tiny WebP (≈20 px, ~170–200 B) inlined as blurred CSS background. Generate it with a small helper around `sharp` (already Astro's dependency), or `astro-lqip`. | `sharp` 0.35.4 (Astro optional dep ^0.35.4); `astro-lqip` 1.8.4 | Astro has **no built-in blur placeholder** (verified in the image docs and reference). A measured 20 px WebP took 29 ms and was 172 B. |
| Hosting | **Cloudflare Workers with Static Assets** (free plan, `*.workers.dev` subdomain) | `wrangler` 4.139.0 | Static asset requests are **free and unlimited**. Commercial use is not prohibited. 20,000 files / 25 MiB per file. Custom domain later. One Worker also hosts the form endpoint on the same origin. |
| Form backend | **Cloudflare Worker route `/api/*`** plus **Cloudflare Turnstile** plus **Resend** (email to owner, photo attached) | `resend` 6.29.0 (or raw `fetch` to REST API); Turnstile (free) | No per-month form caps beyond Resend free (3,000/mo, 100/day). Photo arrives as an attachment in the inbox. Turnstile is free and unlimited. Same-origin JSON/FormData `fetch`, no CORS. |
| Form fallback | **Forminit** (formerly Getform) free plan | n/a (SaaS) | No backend code. File uploads on free (25 MB/submission, 100 MB storage), Turnstile support, no credit card. Limits: 1 form (use a hidden `type` field) and 100 submissions/mo, then the form pauses. |
| Validation | Native HTML constraints on the client; **Zod** in the Worker | `zod` 4.6.5 | Server-side trust boundary. Bundle size doesn't matter in the Worker. |
| Database / CMS / Auth / Payments | **None** | — | Not in the brief. Data lives in `src/data/*.ts` / content collections. |
| SEO | `@astrojs/sitemap` + hand-rolled `<head>` meta/OG in the layout | 3.7.4 | Official, maintained. |
| Unit tests | **Vitest 4.1** + Astro `getViteConfig()` + Container API | `vitest` 4.1.11 | Astro 7.3.5 itself uses `vitest ^4.1.11`. Vitest 5.0.1 is only 3 weeks old and `@cloudflare/vitest-pool-workers` 0.22.0 peers `vitest ^4.1.0`. |
| E2E / a11y | **Playwright** + **@axe-core/playwright** | `@playwright/test` 1.63.0; `@axe-core/playwright` 4.13.0 | Standard. `webServer` runs `astro preview` (or `wrangler dev` for form tests). |
| Types | TypeScript **6.x** (not 7) | `typescript` 6.0.3 | `@astrojs/check` 0.9.10 peers `typescript ^5 || ^6`. TS 7.0.2 is `latest` on npm but would break `astro check`. Astro 7.3.5 itself uses `^6.0.3`. |

## Alternatives considered

**Framework**
- *Next.js 16.3.6 static export*: `next/image` optimization with the default loader is **unsupported** in `output: 'export'` (official docs). You'd need a paid/3rd-party image CDN or a custom loader, and React hydration adds JS. Worse fit for "tiny JS" and "free".
- *SvelteKit 2.70.3 + adapter-static*: good and light, but image optimization means extra tooling (`@sveltejs/enhanced-img`). Astro's built-in `<Picture>` and zero-JS default fit a content/gallery site better. The owner also already knows Astro.
- *Staying on Astro 6*: 7.x is stable (7.3.5, 3 months of patches), with faster builds (Rust compiler, Vite 8). This is a fresh build, so there's no migration cost.

**Styling**
- *Hand-written CSS only*: viable, and the effects layer will be hand-written anyway. Tailwind adds consistency and speed for layout and spacing at ~0 runtime cost.
- *`@astrojs/tailwind`* (6.0.2, last published 2025-09): legacy v3 integration. Don't use it. Use `@tailwindcss/vite` per the official Tailwind + Astro guide.

**Motion**
- *GSAP 3.15.0*: now free for commercial use including all plugins (Standard "no charge" license since 2025-04-30). The only restriction is building no-code tools that compete with Webflow. It's a solid fallback if a hero needs timeline choreography, but not needed at launch.
- *Motion 13.4.3* (MIT): also fine as a fallback. Not needed while CSS covers the effects.
- *Astro `<ClientRouter />`*: turns the site into an SPA router. That adds JS and the script re-init pitfalls that the old site's AOS setup would hit. Native MPA `@view-transition` gets the same effect in Chrome/Safari with 0 KB. Astro's docs say ClientRouter "will increasingly become unnecessary".
- *Lenis/smooth-scroll hijacking*: rejected. It fights native mobile scrolling, which is the opposite of "smooth on phones".

**Lightbox**
- *Native `<dialog>` + CSS scroll-snap*: 0 dependencies, but no pinch-zoom or swipe-to-close, and more custom a11y work. PhotoSwipe is a better quality/size trade.
- *GLightbox 3.3.1*: last published 2025-01, heavier. No advantage.
- Note: PhotoSwipe 5.4.4 was last published 2024-05. It's stable and feature-complete (25k stars), and the repo says v6 is in development. Acceptable, but flagged below.

**Hosting**

| Host | Commercial on free? | Limits that matter | Verdict |
|---|---|---|---|
| Vercel Hobby | **No.** "Hobby teams are restricted to non-commercial personal use only." "Advertising the sale of a product or service" is listed as commercial. Accounts get paused. | 100 GB transfer | **Must leave Vercel.** The current `mod-labs-website.vercel.app` breaks Vercel's terms. |
| Cloudflare Workers (static assets) | Yes. Nothing in the terms prohibits it. | Static asset requests free/unlimited. Worker script invocations 100k/day, 10 ms CPU/request. 20k files, 25 MiB/file. Workers Builds: 3,000 build-min/mo, 20-min timeout, 2 vCPU/8 GB, build cache includes `node_modules/.astro`. | **Chosen** |
| Cloudflare Pages | Yes | 500 builds/mo, 20k files, 25 MiB/file, 100 custom domains | Still supported, but Cloudflare now recommends Workers for new projects (Astro's deploy guide says the same). |
| Netlify Free | Yes (Netlify staff on the forums) | **300 credits/mo hard cap**: production deploy = 15 credits, 1 GB bandwidth = 20 credits. When credits run out, **all projects pause until next cycle** and extra credits can't be bought on Free. Forms are unlimited/free (8 MB request, 1 file per field). | Very good forms, but an image-heavy gallery plus redeploys could take the business site offline mid-month. Keep as a hosting fallback. |
| GitHub Pages | **No.** Prohibits use as an "online business… primarily directed at facilitating commercial transactions". | 1 GB site, 100 GB/mo soft | Borderline for a service business, and it has no form support. Rejected. |

**Form backend (free tiers, verified today)**

| Service | Free submissions | File upload on free | Spam | Notes |
|---|---|---|---|---|
| Worker + Turnstile + Resend | 3,000 emails/mo, 100/day | Yes, as an attachment (Resend max 40 MB/email after base64) | Turnstile (free, unlimited) + honeypot | Without a verified domain, Resend only sends from `onboarding@resend.dev` **to the account owner's own email**, which is exactly this use case. Verify the domain later. |
| Forminit (ex-Getform) | 100/mo, **1 form** | Yes: 25 MB/submission, 100 MB storage | Turnstile, hCaptcha, honeypot | No credit card. Form pauses at the limit. **Fallback.** |
| Netlify Forms | Unlimited | Yes: 8 MB/request, 1 file/field | honeypot, reCAPTCHA 2 | Only works if hosted on Netlify (see credit-cap risk). |
| Formspree | 50/mo | **No** (0 GB on free; uploads from $10/mo) | ML filter, reCAPTCHA | Rejected because of the photo upload. |
| Web3Forms | 250/mo | **No** ("This is a PRO feature") | basic; Turnstile is Pro | Rejected because of the photo upload. |
| Basin | 50/mo | Yes (100 MB) | reCAPTCHA/hCaptcha/Turnstile/honeypot | Viable second fallback. Whether sign-up needs a credit card is *unverified*. |
| FormSubmit.co | "free", no registration | *unverified* | reCAPTCHA redirect page | No SLA, sparse docs. Rejected. |

## Accounts, costs & env vars needed

All accounts are $0. None should need a credit card (*verify at sign-up*, since not every pricing page states it).

| Account | Purpose | Cost | Notes |
|---|---|---|---|
| **Cloudflare** (free) | Workers hosting (`mod-labs.<acct>.workers.dev`), Workers Builds CI, Turnstile widget | $0 | Add the `workers.dev` hostname (and later the custom domain) to the Turnstile widget. Free plan: max 10 hostnames/widget. |
| **Resend** (free) | Sends form emails to Alvaro | $0 (3,000/mo, 100/day) | **Sign up with the inbox Alvaro wants leads in.** Without a domain, it can only send to that address. |
| **GitHub** (existing: `AlvaroEPena`) | Source repo, connected to Workers Builds | $0 | Could be a new repo for the rebuild. |
| Forminit (only if the fallback is used) | Hosted form backend | $0 | 1 form, 100/mo. |
| Custom domain (later, optional) | Brand domain | ~$10–15/yr (the only future cost) | Cloudflare Registrar sells at cost *(price unverified)*. After adding it, verify the domain in Resend. |
| Vercel | Retire it after cutover | — | Hobby forbids commercial use. |

Env vars / secrets:
- `TURNSTILE_SECRET_KEY`: Worker secret (`wrangler secret put`)
- `RESEND_API_KEY`: Worker secret
- `LEAD_EMAIL_TO`: Worker var (must equal the Resend account email until a domain is verified)
- `PUBLIC_TURNSTILE_SITE_KEY`: public, in Astro `.env`
- `PUBLIC_SITE_URL`: canonical/OG base (`site` in `astro.config.mjs`)
- (fallback) `PUBLIC_FORMINIT_FORM_ID`

## Setup notes

**Scaffold (official `create-astro` flags, from its README):**
```
npm create astro@latest <dir> -- --template minimal --install --no-git --no-ai --skip-houston --yes
```
- Supported flags: `--template`, `--install/--no-install`, `--git/--no-git`, `--add`, `--no-ai` (skip AI agent files), `--yes/-y`, `--no/-n`, `--dry-run`, `--skip-houston`, `--ref`, `--fancy` (full Unicode on Windows). `create-astro` is 5.2.4.
- The `--` separator is required with npm.
- `sites/mod-labs/` already contains `docs/`. create-astro warns on a non-empty directory. Scaffold into an empty temp/sub folder and move the files in, or run `--dry-run` first to see how it behaves.
- Then Tailwind, per the official Tailwind guide (not `@astrojs/tailwind`): `npm i tailwindcss @tailwindcss/vite`, add `vite: { plugins: [tailwindcss()] }` to `astro.config.mjs`, and put `@import "tailwindcss";` in `src/styles/global.css`.
- Hosting: `npm i -D wrangler`. Add a `wrangler.jsonc` with `"main": "./worker/index.ts"` and `"assets": { "directory": "./dist/", "binding": "ASSETS", "run_worker_first": ["/api/*"] }`, and set `compatibility_date` to the deploy date. The static site needs **no** `@astrojs/cloudflare` adapter. Deploy with `npx astro build && npx wrangler deploy`, or use Workers Builds (build `npx astro build`, deploy `npx wrangler deploy`). If the Worker uses `Buffer` for base64, add `compatibility_flags: ["nodejs_compat"]`.

**Windows / Node 24 / npm 11 compatibility**
- `astro` 7.3.5 engines: `node >=22.12.0`, `npm >=9.6.5`, so Node 24.21.0 / npm 11.19.0 are fine (odd Node majors are unsupported).
- `sharp` 0.35.4 needs `node >=20.9.0` and ships a prebuilt `@img/sharp-win32-x64` 0.35.4 (plus arm64/ia32). No build tools or Docker needed. Sharp ran fine locally (0.34.5 from the old project) on Node 24.
- `vitest` 4.1.11 engines include `>=24`. Vite 8 (Astro 7 uses `vite ^8.0.13`) is within Vitest 4.1's and `@tailwindcss/vite`'s peer ranges.
- Playwright on Windows: run `npx playwright install chromium` (browsers download to `%LOCALAPPDATA%`).

**Astro 7 gotchas (from the official v7 upgrade guide)**
- The new **Rust compiler is strict**: unclosed or invalid HTML now **fails the build** instead of being auto-fixed.
- `compressHTML` now defaults to **`'jsx'`**, which strips whitespace between inline elements (e.g. `<a>` next to text). Add `{" "}` where needed, or set `compressHTML: true`.
- Markdown now defaults to the Sätteri pipeline. remark/rehype plugins need `@astrojs/markdown-remark`. It's probably not needed here.
- `src/fetch.ts` is a reserved filename. Keep the Worker in `worker/`, outside `src/`.
- `@astrojs/db` was removed. It's irrelevant here.

**Images: approach and measured build cost**
- Keep gallery sources in `src/assets/gallery/<category>/`, **never `public/`** (public files are served raw with their EXIF GPS). Load them with `import.meta.glob('…/*.{jpg,jpeg}', { eager: true })` driven by a data file.
- **One-time pre-processing script** (Node + sharp, run locally): `rotate()` to bake in EXIF orientation, resize to ≤2048 px on the long edge, re-encode JPEG ~q82, and **strip metadata (GPS)**. This also shrinks the repo. The old site's 54 images plus video were 96 MB, and the album is 1.9 GB.
- Use `<Picture formats={['avif','webp']} layout="constrained" widths={[400,800,1200]} sizes=…>` for grid tiles, a 1600 px WebP for the lightbox slide, and `priority` only on the hero. Set `image.responsiveStyles: true` or style it yourself.
- **Measured locally** on one 4032×3024 source (this PC, single thread): WebP 400/800/1200/1600 = 76/159/367/461 ms; AVIF = 188/482/836/1202 ms. AVIF 800 px = 156 KB vs WebP 186 KB. That's about 3.8 s per photo for both formats at 4 widths. For 200 photos, that's roughly 10–13 min of single-thread CPU on the first build. The ≤2048 px pre-resize cuts it significantly (*not measured*). Later builds reuse the `node_modules/.astro` cache, locally and in Workers Builds (cache purged 7 days after last read). **The first CI build on 2 vCPU could approach the 20-min timeout.** Mitigate with the pre-resize, 3 widths, AVIF only where it wins, or build locally with a warm cache and `wrangler deploy`.
- LQIP: 20 px WebP ≈ 170–200 B base64, inlined as `background-image` with `filter: blur()` on the tile. Fade in the real image on `load`.
- Video (`project4.1.mp4`, 11.6 MB): under the 25 MiB limit. Use `preload="none"` + `poster` + `playsinline muted`. Optionally re-encode it smaller.

**Forms**
- Client: `<form method="post" action="/api/quote">` works without JS. JS takes over with `fetch(FormData)` and shows an inline success state.
- Before upload, downscale the photo in the browser (canvas to JPEG ≤1600 px, ~300–600 KB). Cap at 3 files and accept `image/*` (HEIC too). This keeps the Worker well within its 10 ms CPU budget and speeds up mobile uploads.
- Worker: verify the Turnstile token via `siteverify`, check the honeypot, validate with Zod, then POST to Resend with `reply_to` = customer email and attachments as base64. Return JSON (or a 303 to `/thanks` for the no-JS path).

**Motion rules**
- Wrap every effect in `@media (prefers-reduced-motion: no-preference)`. Put scroll timelines in `@supports (animation-timeline: view())`. Animate only `transform`/`opacity`, never box-shadow blur radius on scroll (it's expensive on phones). Pre-render glows with `filter: drop-shadow` or pseudo-element gradients.
- Browser support (MDN browser-compat-data, fetched today):

| Feature | Chrome | Safari (incl. iOS) | Firefox (current 156) |
|---|---|---|---|
| `animation-timeline` (scroll-driven animations) | 115+ | 26+ | flag/preview only |
| `@view-transition` (cross-document) | 126+ | 18.2+ | not supported |
| `document.startViewTransition` (same-document) | 111+ | 18+ | 144+ |

**Testing notes**
- `vitest.config.ts` uses `getViteConfig()` from `astro/config`. Component tests use the Container API.
- Test the Worker handler as a pure function under Node, which has global `Request`/`FormData` on Node 24. Add `@cloudflare/vitest-pool-workers` 0.22.0 only if workerd fidelity is needed; it requires Vitest 4.1.
- Playwright `webServer: npm run preview`. For form e2e, use `wrangler dev` with the Turnstile **test keys** (Cloudflare publishes always-pass/always-fail keys) and a mocked Resend.
- Run axe on every route. Run the e2e suite with the `reducedMotion: 'reduce'` context option too.

## Risks / open questions

1. **Resend without a custom domain** sends from `onboarding@resend.dev`, which is intended for testing, and only to the account owner's inbox. It works for "email the owner", but Resend could tighten it, and lead emails might land in spam. Mitigations: tell Alvaro to whitelist the sender, then add a custom domain and verify it in Resend as soon as possible. Forminit is a drop-in fallback (swap the form `action`/endpoint).
2. **First-build image processing time** (see the measurement above) versus the Workers Builds 20-min timeout. Mitigate with pre-resizing, fewer widths, the warm cache, or deploying from the local machine.
3. **Workers free CPU limit of 10 ms/request** on the form Worker. Multipart parsing plus base64 of a large photo could exceed it (error 1102). Client-side downscaling keeps payloads small. This can't be measured locally, so verify on a deployed preview.
4. **Firefox** gets no page transitions and no scroll-timeline effects. That's graceful degradation by design; the IntersectionObserver reveal keeps the site feeling animated.
5. **PhotoSwipe** was last released in 2024-05 (v6 in development). Low risk, since it's isolated behind a dynamic import. Swap-out cost is small.
6. **Cloudflare CDN terms** let Cloudflare limit free-plan use that serves "video or a disproportionate percentage of pictures". A photo gallery on a small site with one 11.6 MB clip is not a realistic trigger, but it's the reason not to add more video. *(How this clause applies to Workers static assets is not stated.)*
7. **Vercel**: the current live site on Hobby breaks Vercel's commercial-use rule. Plan the cutover and tell customers about the URL change (`*.workers.dev`), or get the custom domain now for a stable URL.
8. **Spam before verification**: the Turnstile widget hostname list must include the exact `workers.dev` hostname, or every submission will fail. Include this in the deploy checklist.
9. Open: which inbox should get leads (it decides the Resend sign-up email)? Should the custom domain be bought now (~$10–15/yr, the only non-free item) to fix risks 1 and 7 together?

## Sources

- Astro v7 upgrade guide: https://docs.astro.build/en/guides/upgrade-to/v7/
- Astro images guide: https://docs.astro.build/en/guides/images/
- Astro assets reference (Image/Picture props, `priority`, `layout`): https://docs.astro.build/en/reference/modules/astro-assets/
- Astro configuration reference (`compressHTML`, `cacheDir`, image options): https://docs.astro.build/en/reference/configuration-reference/
- Astro install & create-astro flags: https://docs.astro.build/en/install-and-setup/ · https://github.com/withastro/astro/blob/main/packages/create-astro/README.md
- Astro Fonts API: https://docs.astro.build/en/guides/fonts/
- Astro view transitions: https://docs.astro.build/en/guides/view-transitions/
- Astro testing: https://docs.astro.build/en/guides/testing/
- Astro deploy to Cloudflare: https://docs.astro.build/en/guides/deploy/cloudflare/
- Tailwind + Astro: https://tailwindcss.com/docs/installation/framework-guides/astro
- Next.js static export (unsupported image optimization): https://nextjs.org/docs/app/guides/static-exports
- Vercel fair use / commercial usage: https://vercel.com/docs/limits/fair-use-guidelines
- Cloudflare Workers static assets billing: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Workers `run_worker_first`: https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
- Workers Builds limits & caching: https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/ · https://developers.cloudflare.com/workers/ci-cd/builds/build-caching/
- Cloudflare Pages limits: https://developers.cloudflare.com/pages/platform/limits/
- Cloudflare service-specific terms (CDN clause): https://www.cloudflare.com/service-specific-terms-application-services/
- Cloudflare Turnstile plans: https://developers.cloudflare.com/turnstile/plans/
- Netlify pricing & credits: https://www.netlify.com/pricing/ · https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/
- Netlify paused projects: https://docs.netlify.com/manage/accounts-and-billing/billing/resume-paused-projects/
- Netlify Forms setup: https://docs.netlify.com/manage/forms/setup/
- Netlify commercial use on free (staff answer): https://answers.netlify.com/t/can-we-use-netlify-free-plan-for-commercial-purposes/41545/2
- GitHub Pages limits/prohibited uses: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- Formspree plans: https://formspree.io/plans
- Web3Forms file attachments (Pro): https://docs.web3forms.com/getting-started/pro-features/file-attachments.md · pricing summary: https://splitforms.com/web3forms-pricing (secondary; web3forms.com returned 403)
- Basin pricing: https://usebasin.com/pricing
- Forminit pricing, file upload, Turnstile: https://forminit.com/pricing/ · https://forminit.com/docs/file-upload/ · https://forminit.com/docs/cloudflare-turnstile/
- Resend pricing & send API: https://resend.com/pricing · https://resend.com/docs/api-reference/emails/send-email
- Resend unverified-domain restriction (secondary): https://github.com/resend/resend-node/issues/454
- GSAP standard license: https://gsap.com/standard-license
- PhotoSwipe: https://github.com/dimsemenov/PhotoSwipe
- MDN browser-compat-data (animation-timeline, @view-transition, startViewTransition): https://github.com/mdn/browser-compat-data
- npm registry (`npm view`, 2026-09-24): astro, create-astro, tailwindcss, @tailwindcss/vite, @astrojs/tailwind, @astrojs/check, @astrojs/sitemap, @astrojs/cloudflare, sharp, @img/sharp-win32-x64, photoswipe, glightbox, gsap, motion, lenis, vitest, @playwright/test, @axe-core/playwright, @cloudflare/vitest-pool-workers, typescript, wrangler, resend, zod, astro-lqip, next, @sveltejs/kit
