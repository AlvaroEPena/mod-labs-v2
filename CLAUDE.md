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
- `npm run check` — typecheck (astro check + worker tsc + admin tsc) + lint + unit tests (incl. `admin/`)
- `npm run build` — production build to `dist/`
- `npm run test:e2e` — Playwright e2e + axe (builds and serves on 8788 via wrangler)
- `npm run admin` — local photo admin on http://127.0.0.1:4400 (`--port N` / `ADMIN_PORT`); spec §15
- `npm run deploy` — build + `wrangler deploy` (**only with the user's explicit OK**)

## Conventions
- Content lives in `src/data/*.ts` (services, builds, projects/gallery, faq, reviews, site). Pages read data; no copy hardcoded that belongs in data.
- Shared form contract: `src/lib/forms/schema.ts` (client + Worker). Changes go through the orchestrator and spec §6.
- Gallery photos: `src/data/photos.json` is the **source of truth** (ordered `{id,file,project,width,height}`; category derives from the project; contract + validation in `src/lib/gallery/records.ts`, checked at build). Files are `src/assets/gallery/photos/pNNNN.jpg`, ids never reused. Add photos only through `npm run admin` (it strips EXIF/GPS via `scripts/lib/process-photo.mjs`); never put photos in `public/`.
- Photo picks (hero, covers, about) live in `src/components/media/picks.ts` by **id** and must never throw (fallback: project → category → first photo).
- `admin/` is a local-only Node server (node:http, no framework, Node runs its `.ts` via type stripping: erasable syntax only, `.ts` import extensions). It is never built or deployed; keep it out of `src/`. `src/data/projects.ts` and `src/lib/gallery/records.ts` must stay import-free so the admin can load them.
- Use `astro:assets` `<Picture>`/`<Image>` for every photo; only the hero image gets `priority`.
- Motion: transform/opacity only; wrap in `prefers-reduced-motion: no-preference`; scroll-driven effects behind `@supports (animation-timeline: view())`.
- Astro 7: invalid/unclosed HTML fails the build. Keep the Worker in `worker/` (not `src/`).
- Never advertise game libraries/preloaded games. Never invent reviews.
- Secrets only in `.dev.vars` (local) / `wrangler secret` (prod). Public values use `PUBLIC_*`.
