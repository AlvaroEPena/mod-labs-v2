# Progress Log

**Current phase:** 4-scaffolding
<!-- phases: 1-intake · 2-research · 3-spec-approved · 4-scaffolded · 5-building (slice N) · 6-qa · 7-review · 8-done -->
**Next step:** scaffold Astro 7 + tooling + content + photo export, then parallel build

## Gate status
| Gate | Status | Last run |
|---|---|---|
| typecheck | – | |
| lint | – | |
| unit | – | |
| build | – | |
| e2e | – | |
| a11y | – | |
| review | – | |

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
