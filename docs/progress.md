# Progress Log

**Current phase:** 8-handoff
<!-- phases: 1-intake · 2-research · 3-spec-approved · 4-scaffolded · 5-building (slice N) · 6-qa · 7-review · 8-done -->
**Next step:** owner: create Cloudflare + Resend accounts, follow README deploy checklist; optional: per-photo alt text, zod/mini for JS budget

## Gate status
| Gate | Status | Last run |
|---|---|---|
| typecheck | pass (0 errors) | 2026-09-24 |
| lint | pass | 2026-09-24 |
| unit | pass 104/104 | 2026-09-24 |
| build | pass 16 pages | 2026-09-24 |
| e2e | pass 257, 0 fail, 51 intentional skips | 2026-09-24 |
| a11y | axe clean all routes; Lighthouse a11y 100 (/), 96 (/gallery, content-visibility artifact) | 2026-09-24 |
| review | no Critical; H1/H2 guarded by predeploy check + README; M1–M5 fixed | 2026-09-24 |

## Log
<!-- newest first: ### <date> — <phase>  · done · decisions · open issues -->

### 2026-09-24 — 1-intake (done)
- Refactor/rebuild of `C:\Users\Alvaro\Desktop\ModdingWebsiteProject` (Astro 6 + Bootstrap + AOS + Formspree).
- Brief confirmed; user added Wii Miicro ($450) and GWii ($900) commission builds (details pulled from FB listings).
- Decisions: premium neon lab design, keep "Mod Labs", forms→email (free), free subdomain, local + mail-in,
  FAQ + how-it-works + reviews (real only), Instagram/TikTok/Discord placeholders.
- Policy: no game-library/preload advertising.
- Defaults applied for unanswered details (see brief "Open questions").

### 2026-09-24 — 2-research + 3-spec (approved)
- research.md: Astro 7.3.5 static + Tailwind 4 + PhotoSwipe + Cloudflare Workers (static assets + /api Worker) + Turnstile + Resend; Vitest 4.1, Playwright 1.63.
- Findings: Vercel Hobby forbids commercial use; Formspree/Web3Forms free lack file uploads.
- Gallery curated: 188 of 451 unique photos (54 dupes) → docs/gallery-curation.json.
- User approved stack + scope. Open owner checks: photo #57 (Spider-Man PS4 Pro), clear RGB Xbox title.

### 2026-09-24 — 4-scaffolded (done) → 5-building
- Astro 7.3.5 minimal scaffold + Tailwind 4, PhotoSwipe, Zod, wrangler, Vitest 4.1, Playwright 1.63 (+chromium), ESLint 10, Prettier. workerd install script allowed in package.json.
- 188 photos exported to src/assets/gallery (≤2048px, metadata stripped, 72.6 MB; verified 0 files with EXIF). Halo video → public/media (no GPS atoms).
- Content data in src/data (site, services, builds, gallery, faq, reviews[] empty), shared form contract src/lib/forms/schema.ts, 6 unit tests passing. check/build green. Commits ac72ad0 + ownership commit.
- Launched in parallel: backend-engineer (worker API, _headers) and frontend-engineer (design, logo, all pages, gallery, forms UI).

### 2026-09-24 — 5-building (done)
- Backend (35ae8b6): Worker /api/book + /api/quote, Turnstile, Zod, photo sniffing, Resend via fetch, EMAIL_MODE log|send, rate limit binding + fallback, _headers CSP. 44 worker tests.
- Frontend (46fb8e5): Oxanium + Geist, new chip/flask logo, circuit hero, all routes, gallery + PhotoSwipe, forms UI (zod client validation, canvas downscale, Turnstile). Agent-reported Lighthouse mobile 95–100.
- Orchestrator: user asked to drop photo #57 and merge clear RGB Xbox into "Custom Halo 4 RGH + RGB Xbox 360" (fa18491). "Get a free quote" → "Get a quote" (no free claim from owner).
- Gates at integration: check 0 errors, 78 unit tests pass, build 16 pages (~6s warm).
- Deferred: per-photo alt text (currently "<project>, photo n of m").

### 2026-09-24 — 6-qa + 7-review
- QA (c9b1e67): 308 e2e tests (251 pass / 6 fail = 3 bugs × 2 projects / 51 intentional skips). Lighthouse mobile: / 99/100/100/100, /gallery 97/96/100/100. audit 0 vulns.
  Bugs: photo picked before JS loads is dropped; lightbox dialog unnamed (axe); /contact is 200 meta-refresh (want 301); back during lightbox open anim (low).
- Review: no Critical. H1 test Turnstile key would ship; H2 placeholder site URL. M1 chunked body bypasses size guard; M2 honeypot "company" autofill trap; M3 parallel full-res decode on phones; M4 "quote is free" claim; M5 no README. Lows L1–L12.
- Done by orchestrator: README + deploy checklist, scripts/predeploy-check.mjs wired into `npm run deploy` (c81432b); honeypot renamed in schema → hp / hp_7f3 (uncommitted, waiting for agents); builds.ts "library" wording.
- Fix round delegated: backend (M1, H1 server-side, L2, L3, L7, _redirects 301, honeypot); frontend (QA bugs 1/2/4, M3, L1, L4, L5, turnstile action, remove astro redirect, M4, "runs cooler" copy, optional zod/mini).
- Interrupted once by API rate limit (agents had made no edits); resumed.

### 2026-09-24 — 7-review fixes (done) → 8-handoff
- Backend ae078bb, frontend fixes commit: all review M-items + QA bugs fixed. Gates rerun by orchestrator: check 0 errors, 104 unit, build OK, e2e 257 pass / 0 fail, audit 0.
- Accepted: /book & /quote JS 31.1 KB gz total (zod lazy on first focus; 1.1 KB over budget) → optional zod/mini later. No-JS form path can't pass Turnstile (noscript note shown). Alt text generic.
- NOT deployed. Owner must do README deploy checklist (Cloudflare, Turnstile, Resend, secrets, .env.production).

### 2026-09-24 — post-handoff changes (owner requests)
- Price badges centred (flex: none), home strip "Switch $120+" derived from data, FAQ microSD advice (256GB+, reputable seller), builds include USB-C PD brick / no cable (7ce850b).
- Workspace: mandatory engineering-standards.md for all agents (e69db38).
- Local photo admin (`npm run admin`, 127.0.0.1:4400): reorder/move/delete→trash/restore/upload. photos.json source of truth, id-based files, id-based picks with fallbacks. check: 155 unit tests; build OK; e2e 257 pass (agent run). Committed.

### 2026-09-25 — custom domain
- modlabs.store bought on Namecheap, nameservers → Cloudflare (alexandra/mark.ns.cloudflare.com), attached to Worker `seattle` as custom domain (also declared in wrangler.jsonc routes).
- www.modlabs.store: proxied DNS record + Redirect Rule "Redirect from WWW to root" (301, query string preserved). Verified 301 www/gallery → modlabs.store/gallery.
- PUBLIC_SITE_URL → https://modlabs.store (canonical, sitemap, robots, OG, JSON-LD).
- Owner TODO: add modlabs.store to Turnstile widget hostnames; later: Resend domain verification + EMAIL_FROM, Cloudflare Email Routing for @modlabs.store.

### 2026-11-05 — glass redesign, phase 1: home (branch `redesign-glass`, NOT merged/pushed)
- Owner asked for a full aesthetic redesign (retro circuit theme kept, glassy + professional), copy rewrite allowed except services' bullet lists; stop after the home page for review. Direction recorded in spec §16 (dials 8/7/4, dark-only, one cyan accent, Geist + Geist Mono, Phosphor icons).
- Done: global design system (global.css), floating glass header, footer + phone CTA pill, new home: hero (GWii #340 in glass frame + powered traces), pricing bento (Xbox #207 / Switch #52 / quote), circuit timeline steps (scroll-drawn), build pair, gallery rail, trust split (bench #254, 9+ yrs), FAQ, CTA slab with socials.
- Checks (orchestrator, local dev): npm run check 0 errors / 196 unit; e2e 259 pass / 51 skip; no horizontal overflow at 1440/390; 0 em/en dashes; 2 eyebrows.
- Other pages inherit the new tokens but are NOT redesigned yet (phase 2 after owner approves the home look).

### 2026-11-05 — glass redesign, phase 2: every page + reviews (branch `redesign-glass`, NOT merged/pushed)
- Owner approved the home look and asked for more: deviate further, interactive, mobile-first, refined icon, reviews (home + own page + form, secure), good SEO by the final push. Then Instagram + ads talk.
- Owner decisions (reviews): approve each review by email; create a free D1 database (orchestrator confirms before running); fields name / stars / review, plus an optional "how did you find us" shown as subtext ("Found us on Google"). No email collected.
- Backend (1ce4ab4): D1 store + migration, POST /api/review (guards, Turnstile action `review`, 2/60 s + 20/24 h cap), signed moderation links (GET confirms, POST acts; 30/365-day expiry), HTMLRewriter publishing on / and /reviews, GET /api/reviews. Predeploy blocks the placeholder D1 id.
- Alt text: hand-written for all 166 photos, optional `alt` in photos.json (f84986e).
- Frontend (95043f1): every page redesigned (services price board + spotlights + Switch tabs, builds spec explorer, gallery view-transition filter + glass lightbox, about trace, book live estimate, quote photo picker, FAQ live filter, legal TOC, 404 oscilloscope), /reviews page + star picker, refined logo/favicons/OG, breadcrumbs + structured data.
- Orchestrator QA fixes before commit: review star picker SVGs had no fill (rendered black), "How did you find us?" label (was wrapping), denser panel over the services photos.
- Gates (orchestrator): check 0 errors / 344 unit; build 17 pages; e2e 341 pass / 61 skip / 0 fail (full run before the small fixes; reviews + interactive specs rerun after: 59 pass / 3 skip).
- Pending: security code review (running), Lighthouse/SEO check, owner OK on the new Reviews section of the privacy policy, D1 creation (waiting for owner "go"), owner sets `REVIEW_SIGNING_KEY` secret, merge to main for the owner to push.

### 2026-11-05 — review + fix round, production D1 → ready to merge
- Security code review: no Critical. H1 (/, /reviews now count against the Workers Free 100k/day quota) → README recommends a free WAF rate-limit rule (owner action). M1-M4 + L1-L9 fixed (commit 0a03e53, spec §18).
- Lighthouse mobile (local wrangler): SEO 100 on every page; perf 95-100 except /gallery (all 166 photos) 89-90 (observed LCP 0.3 s; Lantern counts the early lazy-image fetches). FAQ CLS fixed; gallery a11y 96 → 100; phone tile images halved.
- Production D1 `mod-labs-reviews` created (WNAM, id 135788ab-…) and 0001 applied remotely (reviews + review_limits). Owner set `REVIEW_SIGNING_KEY` with wrangler.
- Privacy Policy + Terms rewritten (professional, providers by category). Owner to confirm: Washington governing law, site-only review license, device-data wording, payment line, the /reviews moderation line.
- Gates (orchestrator, final): check 0 errors / 464 unit; build 17 pages + 9 CSP hashes; e2e 355 pass / 61 skip / 0 fail.
- Next: owner pushes `main` (Workers Builds deploys), then: send a test review, approve it from the email, `curl -I https://modlabs.store/` to confirm hash CSP. Then Instagram + ads discussion.
