# Mod Labs — Spec
_Last updated: 2026-09-24 · Status: approved (2026-09-24)_

## 1. Summary
A complete rebuild of the Mod Labs marketing site: a dark "premium neon lab" site for Al's
Seattle console-modding & electronics-repair business. Goals: look unmistakably pro, load
instantly on phones, show off the work (curated, categorized gallery), and turn visitors into
service/quote/commission requests delivered to Al's email. Static site, no accounts, no DB,
$0 running cost.

## 2. Stack
_Proposed — see `research.md` for evidence and alternatives._
| Layer | Choice | Version |
|---|---|---|
| Framework | Astro (static output) | 7.3.5 |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) + hand-written effects CSS | 4.3.3 |
| Fonts | Astro Fonts API (self-hosted, fallback metrics) | built-in |
| Motion | Native View Transitions + CSS scroll-driven animations + ~1 KB IntersectionObserver fallback | platform |
| Lightbox | PhotoSwipe (lazy-loaded on first tap) | 5.4.4 |
| Images | Astro `<Picture>` AVIF/WebP + build-time LQIP via sharp; one-time pre-process script (rotate, ≤2048px, strip EXIF/GPS) | sharp 0.35.4 |
| Hosting | Cloudflare Workers static assets (free `*.workers.dev`, commercial OK) | wrangler 4.139.0 |
| Forms | Worker `/api/book` + `/api/quote` → Zod validation → Turnstile verify → Resend email (photo as attachment). Fallback: Forminit free | resend 6.29.0, zod 4.6.5 |
| Tests | Vitest 4.1, Playwright, @axe-core/playwright | 4.1.11 / 1.63.0 / 4.13.0 |
| TypeScript | strict | 6.0.3 |

## 3. Sitemap & pages
| Route | Purpose | Rendering |
|---|---|---|
| `/` | Hero (animated logo/circuit traces, headline, CTAs), featured pricing, "How it works" 4 steps, featured builds (GWii / Wii Miicro), gallery teaser by category, trust points, reviews (hidden while empty), Instagram/socials band, final CTA | static |
| `/services` | Modding services + prices (Xbox 360 RGH, Switch OLED/v1-v2/Lite), "What's included" lists, PS4 PPPwn / repairs / custom shells by quote, local vs mail-in panel | static |
| `/builds` | Custom build commissions: **GWii $900**, **Wii Miicro Deluxe $450**: specs, what's included, photo carousel, "Request this build" | static |
| `/gallery` | Category filter tabs (All / Switch / Xbox 360 / PlayStation / Custom Builds / Repairs), project cards with write-ups, masonry grid, lightbox (swipe, keyboard), the Halo Xbox video | static |
| `/gallery/[category]` | Deep-linkable category views (share "see my Switch work") | static |
| `/about` | Al's story (existing copy), how I work, devices & data policy, Seattle local + mail-in | static |
| `/book` | Service request form | static + form API |
| `/quote` | Repair / custom / commission quote form with photo upload; `?build=gwii` preselects | static + form API |
| `/faq` | FAQ accordion (also used on home as teaser) | static |
| `/privacy`, `/terms` | Existing legal copy, updated for new form provider | static |
| `/contact` | Redirect → `/quote` (keeps old URLs working) | redirect |
| `404` | Themed "signal lost" page | static |
| `/sitemap-index.xml`, `/robots.txt` | SEO | build |

## 4. User journeys (→ e2e tests)
- **J1 Book a mod:** Home → "Book a service" → select Switch OLED ($160) → fill name/email/
  delivery (Local drop-off | Mail-in: let's talk) → message ≥20 chars → consent → submit →
  inline success message, no page reload. Invalid email/no service → inline errors, focus
  moves to first error.
- **J2 Quote a repair with photo:** Services → "Get a quote" → type "Electronic repair" →
  attach image (≤ provider limit, image/* only) → submit → success.
- **J3 Commission a build:** Home featured build → `/builds` GWii → "Request this build" →
  `/quote?build=gwii` with request type preset to "Custom build commission: GWii ($900)" →
  submit.
- **J4 Browse work on a phone:** `/gallery` at 375px → tap "Switch" filter → URL updates →
  open photo → swipe to next → close with back gesture/Esc → no layout shift, images lazy.
- **J5 Learn & trust:** Home → FAQ teaser → `/faq` accordion keyboard-operable; About page
  reachable from nav on mobile menu.
- **J6 Old links:** `/contact` → lands on `/quote`.

## 5. Data model (typed content files, no DB)
- `services`: id, name, platform, price (USD integer), summary, includes[], ctaHref
- `builds` (commissions): slug, name, price, tagline, features[], included[], notIncluded[],
  requirements[], photos (project ref), status ("commission")
- `projects` (gallery write-ups): slug, title, category, caption, photos[] (ordered, first =
  cover), video?
- `categories`: slug, title, blurb, cover photo
- `faq`: q, a (markdown-lite)
- `reviews`: name/initial, text, service, source, date (empty → section hidden)
- `site` config: name, tagline, location, socials {instagram, tiktok, discord} (empty →
  hidden / "coming soon"), form endpoint ids, site URL
- Photos: `src/assets/gallery/<category>/<project>-NN.jpg` exported from the curation list,
  max 2400px long edge, **EXIF/GPS stripped**; optimized at build to AVIF/WebP responsive sets.

## 6. Form contract
Both forms submit via `fetch` (progressive enhancement: works as plain POST without JS).
Shared field schema (validated client-side; provider validates server-side):
| Form | Fields |
|---|---|
| book | name (2–80), email, phone?, delivery ∈ {Local drop-off (Seattle), Mail-in (let's talk)}, services[] ≥1 of the 4 priced services, message (20–2000), consent=true, honeypot |
| quote | name, email, phone?, request_type ∈ {Electronic repair, Custom build commission: GWii ($900), Custom build commission: Wii Miicro Deluxe ($450), PS4 / other mod, General question}, delivery, message (20–2000), photo? (image/*, size ≤ provider limit), consent, honeypot |
Responses → inline success/error states; provider errors show a friendly fallback with
socials/DM link.

## 7. Auth & permissions
None. Public site.

## 8. Integrations & env vars
- Cloudflare (hosting, Worker API, Turnstile) · Resend (email to Al's inbox).
- Secrets (Worker, via `.dev.vars` locally / `wrangler secret` in prod): `TURNSTILE_SECRET_KEY`,
  `RESEND_API_KEY`, `LEAD_EMAIL_TO`. Public: `PUBLIC_TURNSTILE_SITE_KEY`, `PUBLIC_SITE_URL`.
- Dev without keys: API returns a clear "email not configured" error and logs the payload;
  Turnstile uses Cloudflare's official always-pass test keys.
- Worker CPU (10 ms free): client downsizes photos to ≤1600px JPEG before upload.

## 9. Design system: "Premium neon lab"
- **Palette:** bg #070815 → surfaces #0f1230 / #141a44; neon cyan #00e5ff (primary),
  purple #a855f7, magenta #ff3df2 (accents, sparingly); text #f2f5ff, muted #b2b8df.
  Contrast checked AA.
- **Type:** a display face with a technical feel for headings + a clean variable sans for
  body (self-hosted, subset, `font-display: swap`, size-adjusted fallback → no CLS).
- **Motifs:** animated SVG circuit traces that "power on" in the hero, subtle grid/PCB
  texture, glow edges on cards on hover, glassy sticky header, scanline shimmer on price tags,
  solder-joint dot bullets.
- **Logo:** new SVG wordmark + monogram (chip/flask hybrid "ML" in neon trace style) → favicon,
  apple-touch-icon, OG image.
- **Motion:** CSS-first (scroll-driven reveals, view transitions between pages), ≤60fps
  transforms/opacity only, everything disabled under `prefers-reduced-motion`.
- **Breakpoints:** 375 / 768 / 1024 / 1440. Mobile: bottom-reachable CTA bar ("Book" /
  "Quote"), 44px touch targets.
- **Voice:** first-person, friendly, confident, noob-friendly ("Questions welcome. I'll walk
  you through it").

## 10. Non-functional
- Performance: Lighthouse mobile ≥95 perf target (gate ≥90); LCP < 2.0s on 4G; CLS < 0.05;
  JS < 30 KB gz on non-gallery pages; images lazy + responsive + LQIP placeholders.
- SEO: per-page titles/descriptions, OG/Twitter images, LocalBusiness JSON-LD (Seattle, no
  street address), sitemap, robots, canonical URLs.
- A11y: WCAG 2.2 AA; axe clean; keyboard lightbox & menus; alt text for every photo.
- Security/privacy: no secrets in client; honeypot + provider spam filtering; EXIF stripped;
  security headers via host config.
- Content policy: no advertising of game libraries or preloaded games.

## 11. Work breakdown & file ownership
_Finalized after stack approval._ Planned split:
- Orchestrator: scaffold, tooling, content/data files + types, photo export pipeline, config.
- frontend-engineer: design system, logo/SVG art, layout, all pages/components, gallery +
  lightbox, forms UI + client validation + submit handling.
- backend-engineer: Worker entry (`worker/**`), `/api/book` + `/api/quote`, Zod schemas usage,
  Turnstile verification, Resend email templates, rate limiting, unit tests; `wrangler.jsonc`.
- qa-tester: e2e J1–J6, a11y, responsive, gates. code-reviewer: final review.

## 12. Out of scope / later
Custom domain; Instagram feed embed; calendar booking; payments/deposits; CMS.

## 13. Changelog
- 2026-09-24: draft from brief + curation.
