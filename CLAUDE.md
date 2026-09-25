# Mod Labs — Project Rules

Al's Seattle console-modding & electronics-repair business site ("premium neon lab").
Part of the web-dev-agent workspace; this folder is a fully independent project (own deps, own git repo).

## Read first
- `docs/brief.md` — what the user wants
- `docs/spec.md` — pages, journeys, form contract, design system, ownership (source of truth)
- `docs/research.md` — why this stack; Astro 7 / Cloudflare gotchas
- `docs/progress.md` — current phase and next step

## Stack
Astro 7.3 (static) · Tailwind CSS 4.3 (`@tailwindcss/vite`) · PhotoSwipe 5 · Zod 4 ·
Cloudflare Workers static assets + `worker/` for `/api/*` · Turnstile · Resend ·
Vitest 4.1 · Playwright 1.63 + axe · TypeScript 6 strict.

## Commands (run from this folder)
- `npm run dev` — Astro dev server, port 4321 (static pages only; /api not available)
- `npm run dev:full` — build + `wrangler dev` on 8787 (site + form API; uses `.dev.vars`)
- `npm run check` — typecheck (astro check + worker tsc) + lint + unit tests
- `npm run build` — production build to `dist/`
- `npm run test:e2e` — Playwright e2e + axe (builds and serves on 8788 via wrangler)
- `npm run photos` — re-export curated gallery photos (strips EXIF/GPS) — only when curation changes
- `npm run deploy` — build + `wrangler deploy` (**only with the user's explicit OK**)

## Conventions
- Content lives in `src/data/*.ts` (services, builds, gallery, faq, reviews, site). Pages read data; no copy hardcoded that belongs in data.
- Shared form contract: `src/lib/forms/schema.ts` (client + Worker). Changes go through the orchestrator and spec §6.
- Gallery photos: `src/assets/gallery/<category>/*.jpg` (generated — never hand-add un-stripped photos; never put photos in `public/`).
- Use `astro:assets` `<Picture>`/`<Image>` for every photo; only the hero image gets `priority`.
- Motion: transform/opacity only; wrap in `prefers-reduced-motion: no-preference`; scroll-driven effects behind `@supports (animation-timeline: view())`.
- Astro 7: invalid/unclosed HTML fails the build. Keep the Worker in `worker/` (not `src/`).
- Never advertise game libraries/preloaded games. Never invent reviews.
- Secrets only in `.dev.vars` (local) / `wrangler secret` (prod). Public values use `PUBLIC_*`.
