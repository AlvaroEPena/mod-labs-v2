# Mod Labs — Spec
_Last updated: 2026-09-24 · Status: approved (2026-09-24)_

## 1. Summary
A complete rebuild of the Mod Labs marketing site: a dark "premium neon lab" site for Alvaro's
Seattle console-modding & electronics-repair business. Goals: look unmistakably pro, load
instantly on phones, show off the work (curated, categorized gallery), and turn visitors into
service/quote/commission requests delivered to Alvaro's email. Static site, no accounts, no DB,
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
| `/about` | Alvaro's story (existing copy), how I work, devices & data policy, Seattle local + mail-in | static |
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
| quote | name, email, phone?, requestType ∈ {Electronic repair, Custom build commission: GWii ($900), Custom build commission: Wii Miicro Deluxe ($450), PS4 / other mod, Custom shell or RGB, General question}, delivery, message (20–2000), photo? (image/*, size ≤ provider limit), consent, honeypot |
Responses → inline success/error states; provider errors show a friendly fallback with
socials/DM link.

## 7. Auth & permissions
None. Public site.

## 8. Integrations & env vars
- Cloudflare (hosting, Worker API, Turnstile) · Resend (email to Alvaro's inbox).
- Secrets (Worker, via `.dev.vars` locally / `wrangler secret` in prod): `TURNSTILE_SECRET_KEY`,
  `RESEND_API_KEY`, `LEAD_EMAIL_TO`, `REVIEW_SIGNING_KEY` (≥ 32 chars, signs moderation links). Public: `PUBLIC_TURNSTILE_SITE_KEY`, `PUBLIC_SITE_URL`.
- Bindings: `DB` (D1 `mod-labs-reviews`, schema in `migrations/`), `FORM_RATE_LIMITER` (5 / 60 s),
  `REVIEW_RATE_LIMITER` (2 / 60 s) + a global rolling cap of 20 new reviews / 24 h in `worker/reviews/submit.ts`.
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

## 14. Build-phase ownership (2026-09-24)
| Owner | May edit | Read-only |
|---|---|---|
| frontend-engineer | `src/pages/**`, `src/components/**`, `src/layouts/**`, `src/styles/**`, `src/scripts/**`, `src/assets/brand/**`, `public/**` (except `public/_headers`, `public/media/**`), `astro.config.mjs`, `package.json` deps (only agent allowed to `npm install`), component unit tests `src/**/*.test.ts` | `src/data/**`, `src/lib/forms/schema.ts`, `src/assets/gallery/**`, `worker/**`, `wrangler.jsonc` |
| backend-engineer | `worker/**` (incl. `worker/**/*.test.ts`), `wrangler.jsonc`, `.dev.vars.example`, `public/_headers` | everything else; no `npm install` (use `fetch` for Resend) |
| orchestrator | `src/data/**`, `src/lib/forms/**`, `docs/**`, `tests/unit/**`, `playwright.config.ts`, `CLAUDE.md` | |
API env: `EMAIL_MODE` = `log` (dev/tests: console only, returns success) | `send` (prod, default).

## 15. Local photo admin (added 2026-09-24, owner request)
Owner chose **local-only** (never deployed) with: move, delete, reorder, upload photos.
Not in scope: editing text/prices, online access.

**Data model change**
- `src/data/photos.json` becomes the hand/admin-edited **source of truth**: an ordered array of
  `{ id, file, project, width, height }`. Array order = display order within a project, and the first
  photo of a project is its cover. Category is derived from `project` (via `projects` in gallery.ts).
- Files move to stable, id-based names: `src/assets/gallery/photos/p0001.jpg` (4-digit, never reused).
  Moving a photo between projects/categories is then a data-only edit, with no file renames.
- `scripts/export-photos.mjs` + `photo-sources.json` + `docs/gallery-curation.json` are retired as a
  pipeline (a one-time migration script converts the current state; curation JSON is kept as history).
- Presentation picks (`src/components/media/picks.ts`) reference photos by **id** and fall back
  gracefully (first photo of the project/category) if a picked photo is moved or deleted. They never throw.

**Admin app** (`admin/`, outside `src/`, never built or deployed)
- `npm run admin` starts a small Node server (no framework) bound to **127.0.0.1** only and prints the URL.
- Security (local, but still): a random per-run token is required on every API call (embedded in the page);
  Host must be `127.0.0.1:<port>`/`localhost:<port>` (DNS-rebinding guard); state-changing requests
  require a same-origin `Origin`; JSON body limits; upload size/type limits; paths are never taken from the client.
- UI: grouped by category → project, with thumbnails (generated with sharp, cached under
  `node_modules/.cache/mod-labs-admin/`). The shared operations are:
  - **Reorder:** drag and drop, plus keyboard/button alternatives (up/down, move to top).
  - **Move** to another project (a select grouped by category).
  - **Delete**, with confirmation. The file goes to a gitignored `.admin-trash/` and can be restored
    from the trash view.
  - **Upload** (multi-file) into a chosen project: rotate, resize to ≤2048px, strip ALL metadata (GPS),
    save as JPEG q82. Unsupported formats (e.g. HEIC if sharp can't decode) get a clear error.
- Every change is written atomically (temp file + rename) with stable pretty JSON. Astro dev
  hot-reloads if it's running. The UI reminds the owner to `npm run deploy` to publish, and
  shows uncommitted changes (`git status` of the gallery paths).
- Processing logic is shared with the migration (`scripts/lib/process-photo.mjs`). Pure list operations
  (`admin/lib/photos.ts`: move/reorder/delete/restore/add, plus validation like unique ids and known
  projects) are unit tested. Server handlers are tested for the token/Host/Origin guards.

**Implementation notes (2026-09-24, frontend build of §15)** — where the build made a concrete choice or deviated:
- *Shared contract:* `categories`/`projects` moved verbatim from `gallery.ts` to import-free `src/data/projects.ts`
  (re-exported by `gallery.ts`, API unchanged), and the photos.json contract/validation/format lives in
  `src/lib/gallery/records.ts`. Why: the admin runs in plain Node and can't import `gallery.ts` (it uses
  `import.meta.glob`), and the rules must not be duplicated. Build-time checks add: file name must equal
  `photos/p<id>.jpg`, width/height must match the actual file, and the list must not be empty.
- *photos.json format:* one photo per line (stable key order), always written **grouped by project** in
  `projects.ts` order (each project in its display order). The file is then fully determined by what the
  site shows, so any undo (move out and back, delete then restore) gives identical bytes and a clean git diff.
  The migration regrouped the old per-category export order this way; per-project display order is unchanged.
  It's in `.prettierignore`.
- *Thumbnails* carry the token as `?t=` (an `<img>` can't send headers); only the thumb route accepts it,
  and every response sends `Referrer-Policy: no-referrer`. All other API calls need the `X-Admin-Token` header.
- *Uploads* are one file per request (XHR for upload progress; a 40 MB per-file limit, counted while reading).
- *Restore* returns a photo to its exact old index if nothing around it changed (photos.json then ends up
  byte-identical), else right after its old neighbour, else first (if it was the cover) or last in its project.
- *"Unpublished changes"* is the number of changed files under the gallery paths since the last **git commit**
  (git can't know what was deployed). The banner always shows the `npm run deploy` hint.
- *Picks:* the about page's two photos also moved from file names to ids (254, 351).

**Update (2026-09-24, owner feedback after first use): multi-select + real drag and drop**
- *Multi-select:* every card's photo is a toggle button (`aria-pressed`; click or Space selects, Shift = range
  within a project), plus "Select all" per project. Selections span projects. A sticky bar shows
  "N selected · Move… · Delete · Clear"; Esc clears. The Trash has the same selection with "Restore N".
- *Batch API (replaces the single-photo endpoints and `/api/reorder`; each is one atomic photos.json write,
  every id validated first, all or nothing, 409 on stale input):*
  - `POST /api/move {ids, project, beforeId|null}`: photos (any projects) land in `project` before `beforeId`
    or at its end, keeping their current relative order. Used by the Move dialog, drag and drop and keyboard moves.
  - `POST /api/arrange {layout: {project: ids[]}}`: exact contents and order of some projects (Undo of a move/drag).
  - `POST /api/delete {ids}` / `POST /api/restore {ids}`: one confirmation and one Undo per batch; a batch
    restore rebuilds the exact previous order. The trash manifest format is unchanged (older entries still restore).
- *Drag and drop:* HTML5 DnD was replaced by a Pointer Events sortable (`admin/public/sortable.js`) that works
  from anywhere on a card (mouse/pen after 6px; touch after a 280ms hold, so swipes still scroll), with a
  floating ghost (count badge for several), a placeholder gap, FLIP animations, edge auto-scroll, Esc to cancel,
  and drops into other projects. Dragging a selected card drags the selection. The page re-renders the predicted
  order immediately (`public/order.js` mirrors the server's `movePhotos`), then shows "Saved" with Undo.
  Arrow buttons stay as the single-pointer alternative to dragging (WCAG 2.5.7).
- *Keyboard:* with a photo focused, arrows/Home/End move it. Changes are queued, so fast repeated presses all
  count, and focus stays on the same photo, scrolled smoothly into view and briefly highlighted.
- *Testing option:* `--root <dir>` / `ADMIN_ROOT` points the admin at a copy of the data (never test on the real photos).

**Update (2026-09-25, owner request): video management**
- *Data:* videos moved out of `projects.ts` into `src/data/videos.json` (source of truth, ordered
  `{ id, file, project, title, posterId? }`, one per line, grouped by project like photos.json). Files stay in
  `public/media/`; uploads are `v<id>.mp4` (ids never reused, counting the trash and files on disk). Contract +
  validation in import-free `src/lib/gallery/video-records.ts`; `gallery.ts` (`videos`, `videosFor`) fails the build
  on duplicate ids/files, unknown projects, missing files, files over 24 MiB (Cloudflare rejects >25 MiB), empty or
  >120-char titles, or a `posterId` that isn't an existing photo. The `Project.videos` field is gone.
- *Posters:* `posterId` in videos.json is the only poster choice. The halo entry was migrated with `posterId: 19`,
  replacing the hard-coded `VIDEO_POSTERS` in picks.ts, and all 16 built pages are byte-identical to before.
  Omitted = the project cover. Deleting a photo used as a poster switches those videos to automatic (the photo's
  trash entry remembers them and restoring it re-links them), so an admin delete can never break the build.
- *Processing* (`scripts/lib/process-video.mjs`, ffmpeg from the `ffmpeg-static` optionalDependency, loaded lazily so a missing binary never breaks the site build or the photo admin; it ships no ffprobe,
  so `ffmpeg -i` output is parsed): inputs over 500 MB or 3 minutes are refused with a clear message. Always an MP4
  with `-map_metadata -1 -map_chapters -1 -fflags +bitexact -movflags +faststart` (no GPS/©xyz/ISO6709, no dates, no
  encoder tags). Stream copy for H.264 yuv420p + AAC that fits 24 MiB (the phone's rotation flag is kept); otherwise
  capped-CRF H.264 (CRF 26→28→30→32, ≤1080→720→540 px, AAC 128→96→64k, preset medium) with auto-rotation, stepping
  down until ≤ 24 MiB. The output is then verified box by box (moov before mdat; no udta/meta/keys/loci/uuid/©
  boxes; zeroed mvhd/tkhd/mdhd times; no location strings; only basic tags) and rejected otherwise. ffmpeg always
  writes an empty `udta/meta/ilst`; it is retyped to `free` so the file has no metadata atoms at all.
- *Admin API* (same token/Host/Origin guards; ids and slugs validated; file paths only from validated records):
  `POST /api/videos/upload?project&title&name` (raw file body streamed to disk, 500 MB cap counted while reading;
  202 + job), `GET /api/videos/jobs/:id` (state/stage/progress; jobs run one at a time in the background, ffmpeg in
  a child process), `POST /api/videos/{move,arrange,update,delete,restore}`, and `GET /api/video/:id?t=` (preview
  with Range support; the CSP gained `media-src 'self'`). Video trash: `.admin-trash/<file>` + `.admin-trash/videos.json`.
- *Admin UI:* a "Videos" strip above each project's photos (poster + play button, title, ‹ › / drag reorder via the
  shared sortable, Rename…, Poster… picker, Move…, Delete with Undo; the Trash view has a Videos section with
  Restore). The pure list operations are now generic (`admin/lib/list-ops.ts`) and shared by photos and videos.
- *Known limit (render unchanged, as asked):* the site shows every video cropped to 9:16 (`aspect-ratio: 9/16;
  object-fit: cover`, width/height 1080×1920). Landscape uploads will be cropped until the render uses real sizes.

## 16. Glass redesign (2026-11-05, owner request) — branch `redesign-glass`
**Design read:** redesign (overhaul) of a one-person console-modding & repair shop site for gamers and
console owners, mostly on phones, in a premium frosted-glass language over the retro PCB/circuit motif,
on the existing Astro + Tailwind v4 stack (native CSS glass, SVG traces, CSS scroll-driven motion).
Owner constraints: keep the retro electrical-circuit theme; glassy, professional, beautiful; reuse all
content and photos; copy may be rewritten EXCEPT the services' bullet lists (`services.ts` `includes`).
Phase 1 = home page, then owner review before other pages.

- **Dials:** DESIGN_VARIANCE 8 · MOTION_INTENSITY 7 · VISUAL_DENSITY 4 (taste skill, overhaul = baseline +2 on
  variance/motion over the old ~6/5/4).
- **Visual source:** `design-taste-frontend` only (no image-generation tool connected; image-to-code not used).
- **Theme lock:** dark only. The brand is a lit-circuit "lab" whose glow/glass depth only reads on dark; a light
  mode would lose the identity (skill §8.C override). `color-scheme: dark`.
- **Palette:** off-black blue base `#05070e`; ONE accent: softened brand cyan `#4ee0ef` (UI, traces, focus).
  Purple/magenta survive only in the logo and as faint ambient light behind glass, never on UI.
- **Type:** Geist (display + body, tight tracking on headlines) + Geist Mono for technical labels and prices
  (silkscreen feel). Oxanium retired.
- **Glass:** `.glass` = translucent gradient + 1px white/9% border + inset top highlight + backdrop blur, used
  where glass sits over imagery or the page (header, hero card, photo overlays). Content cards use the same look
  without blur (perf on phones). `prefers-reduced-transparency` → solid panels.
- **Shape lock:** cards/panels 20-28px radius, buttons/chips full pill, inputs 12px.
- **Icons:** Phosphor (`@phosphor-icons/core`, regular weight) behind the existing `<Icon name>` API.
- **Motion:** hero entrance stagger + powered-on circuit traces with current pulses (storytelling), scroll reveals,
  scroll-drawn trace through the 4 steps (sequence), pointer spotlight on cards (feedback), gallery rail with
  scroll-snap. All off under `prefers-reduced-motion`.
- **Home layout families (no repeats):** asymmetric split hero → pricing bento (3 cells) → circuit timeline →
  asymmetric build pair → full-bleed gallery rail → photo + 2-col trust split → FAQ accordion → CTA slab with socials.
  Eyebrows: 2 (hero, builds) for 8 sections.

## 17. Reviews (2026-11-05, owner decisions) + phase 2 redesign
**Owner decisions:** anyone can submit; **nothing is published until the owner approves it** (email with
Approve / Delete); fields: name, 1-5 stars, optional service, optional "how did you hear about us" (Facebook / Google / Instagram /
a friend / other, shown as subtext like "Found us on Facebook"), review text (no email collected); a free
Cloudflare D1 database stores them (owner approved creating it; orchestrator creates it, confirming first).

**Contract:** `src/lib/reviews/contract.ts` (schema, field names, `PublicReview`, `renderReviewItem`, slots).
Only `renderReviewItem` produces review HTML, and it escapes every user string. No links allowed in reviews.

**Flow**
1. `/reviews` form → `POST /api/review` (multipart, `Accept: application/json`): same guards as book/quote
   (origin, rate limit, body size, honeypot, Turnstile action `review`, zod) → row `status='pending'` in D1 →
   moderation email to `LEAD_EMAIL_TO` (log mode prints the links) → `ApiResult` ok/errors.
2. Moderation: signed links `GET /api/reviews/moderate?id&action=approve|delete&exp&sig` (HMAC-SHA256 with
   secret `REVIEW_SIGNING_KEY`). GET only shows a confirmation page; the change happens on POST (email link
   scanners prefetch GETs). Approve → `approved`, delete → row removed. Cached list purged.
3. Publishing: the Worker runs first for `/` and `/reviews`, fetches the static page and HTMLRewriter-injects
   approved reviews into `REVIEW_SLOTS` (home: latest 3; all: every approved, newest first), sets the summary
   text and toggles `[data-reviews-when-empty]` / `[data-reviews-when-any]` via the `hidden` attribute.
   Reviews are therefore in the HTML (crawlable, no client JS). Any DB error → page served untouched.
   `GET /api/reviews` returns `{ ok, reviews, count, average }` (approved only).
4. Markup contract (global CSS, not component-scoped, since it's injected):
   `li.review-card > figure > span.review-stars[role=img] > span.star(.is-on)×5, blockquote.review-body > p,
   figcaption.review-by > span.review-name + span.review-source (optional) + span.review-meta`.
   D1 row stores `source` too.
5. Limits (as built): 2 reviews / 60 s per IP (binding) plus the global 20 / 24 h cap; approve links expire
   after 30 days, delete links after 365 days; moderation pages send a strict CSP and `noindex`.
   No email, IP or user agent is stored.

**Phase 2 redesign scope:** every remaining page in the lab-glass system (spec §16), allowed to deviate further
from the original, more interactive (motivated motion only), mobile-first; refined logo mark + regenerated
favicon / touch icon / OG image; new `/reviews` page + home reviews section; "Reviews" in nav and footer.
**SEO (must hold by the final push):** unique titles/descriptions, one h1 per page, BreadcrumbList on inner
pages, Service/Offer data on /services, Offer data for builds, FAQPage on /faq, LocalBusiness on home,
descriptive photo alt text, sitemap incl. /reviews, OG image, Lighthouse mobile SEO 100 and perf ≥ 90.

**Ownership (phase 2, parallel):**
| Owner | May edit | Read-only |
|---|---|---|
| frontend-engineer | `src/pages/**`, `src/components/**` (incl. `layout/seo.ts`, `nav.ts`), `src/styles/**`, `src/scripts/**`, `src/assets/brand/**`, `public/**` except `_headers`/`_redirects`/`media/**`, `scripts/brand-assets.mjs`, `astro.config.mjs`, `package.json` dependencies, `tests/e2e/**` (update for new markup without weakening intent), delete `src/data/reviews.ts` | `src/lib/**`, other `src/data/**`, `worker/**`, `wrangler.jsonc`, `migrations/**`, `admin/**` |
| backend-engineer | `worker/**`, `migrations/**`, `wrangler.jsonc`, `.dev.vars.example`, `public/_headers`, the `webServer` command in `playwright.config.ts` | everything else; no `package.json` edits (report needed scripts) |
| orchestrator | `src/lib/**`, `src/data/**`, `docs/**`, `scripts/predeploy-check.mjs`, `package.json` scripts | |
