# Mod Labs

Website for **Mod Labs**, Al's console modding and electronics repair shop in Seattle.
It covers the services and prices, the custom build commissions (GWii and Wii Miicro), a
categorized gallery, and the booking and quote forms, which email Al.

**Stack:**
- Astro 7 (static site)
- Tailwind CSS 4
- PhotoSwipe
- Cloudflare Workers (static assets, plus a small Worker for `/api/*`)
- Cloudflare Turnstile
- Resend
- Zod
- Vitest and Playwright

Everything runs on free plans.

## Setup
```bash
npm install
npx playwright install chromium   # only needed for e2e tests
cp .env.example .env              # public build-time values (test Turnstile key by default)
cp .dev.vars.example .dev.vars    # Worker secrets for local dev (EMAIL_MODE=log → no real email)
```
Needs Node ≥ 22.12. It's built and tested on Node 24 with npm 11 on Windows.

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Astro dev server on http://localhost:4321. Pages only; the forms can't submit here. |
| `npm run dev:full` | Builds the site, then runs it with the form API via `wrangler dev` on http://localhost:8787. |
| `npm run check` | Type checks, lint and unit tests |
| `npm run build` | Production build to `dist/` |
| `npm run test:e2e` | Playwright end-to-end, accessibility and responsive tests |
| `npm run admin` | Opens the local photo admin at http://127.0.0.1:4400 (this computer only). See "Managing photos" below. |
| `npm run deploy` | Runs the safety checks, builds and deploys to Cloudflare. See the checklist below. |

## Editing content
All the text lives in `src/data/`:
- `services.ts`: prices and what's included
- `builds.ts`: the GWii and Wii Miicro commissions
- `projects.ts`: gallery categories and project write-ups
- `photos.json`: the gallery photos and their order (use `npm run admin` rather than editing by hand)
- `faq.ts`: the FAQ
- `reviews.ts`: **real** reviews only. The section stays hidden while this is empty.
- `site.ts`: social links. Empty links stay hidden.

## Managing photos
Gallery photos are managed with a small admin page that runs **only on your computer**. It is
never uploaded with the site, needs no account, and costs nothing.

1. In this folder, run `npm run admin` and open the address it prints (http://127.0.0.1:4400).
   Leave the terminal open while you work; press Ctrl+C there to stop it.
2. Make your changes. Each one is saved straight away:
   - **Drag to reorder:** grab a photo anywhere on its card and drop it where you want it. A dashed
     gap shows where it will land and the other photos slide out of the way. You can drop it into a
     **different project** too; hold it near the top or bottom of the window and the page scrolls.
     Press **Esc** while dragging to cancel. On a touch screen, press and hold a photo, then drag.
     After a drop you'll see "Saved" with an **Undo** button.
   - **Select several:** click photos (a ✓ appears), or press Space on a focused photo.
     **Shift-click** selects everything between two photos in a project, and **Select all** selects
     a whole project. Selections can span projects. A bar appears at the bottom:
     "N selected · Move… · Delete · Clear" (Esc also clears it). Dragging a selected photo drags the
     whole selection.
   - **Move…** puts photos in another project (they land at the end, in their current order).
   - **Delete** asks once (however many photos), then moves them to the **Trash**. Nothing is
     lost: one **Undo** right after brings them all back, or open the Trash tab later, select photos
     and press **Restore** (each goes back where it was).
   - **Arrows and cover:** each card's ‹ › buttons move it one place and ★ makes it the project's
     **cover** (the first photo is the one the site shows first). With a photo focused, the arrow
     keys, Home and End move it too; it stays highlighted and in view as it moves.
   - **Add photos:** choose the project, pick or drag in one or more photos, then press Upload.
     Each photo is turned upright, resized to at most 2048 px and saved as a JPEG with **all hidden
     data removed** (including GPS location). iPhone HEIC photos can't be read: set the iPhone to
     Settings → Camera → Formats → Most Compatible, or share/export them as JPEG first.
3. Optional preview: in a second terminal run `npm run dev` and open http://localhost:4321/gallery.
   It refreshes as you make changes.
4. **Publish:** run `npm run deploy`. The admin's banner shows how many gallery files have
   changed since the last git commit.

Good to know:
- `src/data/photos.json` is the list of photos (order, project, size). The photos themselves are
  `src/assets/gallery/photos/p0001.jpg` and so on, named by a number that is never reused.
- The Trash lives in `.admin-trash/` in this folder. It is never published. To free the space for
  good, delete that folder (this can't be undone).
- If a photo picked for the home page, the builds page or the about page is moved or deleted, the
  site shows the first photo of that project or category instead. Nothing breaks.
- To use another port: `npm run admin -- --port 4401`.
- For testing (developers): `npm run admin -- --port 4455 --root <folder>` (or `ADMIN_ROOT=<folder>`)
  runs the admin on a **copy** of the data: `<folder>/src/data/photos.json`,
  `<folder>/src/assets/gallery/photos/` and `<folder>/.admin-trash/`. The real photos are untouched.

## Environment variables
| Name | Where | Purpose |
|---|---|---|
| `PUBLIC_SITE_URL` | `.env` / `.env.production` (build time) | The live address, used for canonical URLs, the sitemap and social previews |
| `PUBLIC_TURNSTILE_SITE_KEY` | `.env` / `.env.production` (build time) | The Turnstile widget key (it's public) |
| `TURNSTILE_SECRET_KEY` | Worker secret | Verifies the spam check |
| `RESEND_API_KEY` | Worker secret | Sends the lead emails |
| `LEAD_EMAIL_TO` | Worker secret | The inbox that receives requests |
| `EMAIL_FROM` | Worker var (optional) | The sender address, once a domain is verified in Resend |
| `EMAIL_MODE` | Worker var | `send` in production (set in `wrangler.jsonc`), `log` locally |

## Deploy checklist (first launch)
All free. Do these in order:

1. **Cloudflare account.** Sign up at dash.cloudflare.com. Under **Workers & Pages**, note your
   `workers.dev` subdomain. Your site will be at `https://mod-labs.<subdomain>.workers.dev`.
2. **Log in from this folder:** `npx wrangler login`
3. **Turnstile.** In the Cloudflare dashboard, go to **Turnstile → Add widget**. Add the hostname
   `mod-labs.<subdomain>.workers.dev` (and your custom domain later) and choose the "Managed"
   mode. Copy the **site key** and the **secret key**.
4. **Resend.** Sign up at resend.com **with the email address that should receive the leads**,
   then create an API key. Until you verify your own domain, Resend can only send to that
   address, and the emails come from `onboarding@resend.dev`, so check your spam folder the
   first time.
5. **Create `.env.production`** in this folder. It's gitignored:
   ```
   PUBLIC_SITE_URL=https://mod-labs.<subdomain>.workers.dev
   PUBLIC_TURNSTILE_SITE_KEY=<site key from step 3>
   ```
6. **Set the Worker secrets.** Each command asks you to paste the value:
   ```bash
   npx wrangler secret put TURNSTILE_SECRET_KEY
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put LEAD_EMAIL_TO
   ```
7. **Deploy:** `npm run deploy`. This refuses to deploy if the site URL is the placeholder or
   the Turnstile key is the test key.
8. **Test it live.** Send one booking and one quote with a photo, and check that both emails
   arrive.

### Adding a custom domain later
1. Add the domain in Cloudflare, under **Workers → mod-labs → Settings → Domains & Routes**.
2. Add the domain to the Turnstile widget's hostname list.
3. Update `PUBLIC_SITE_URL` in `.env.production` and redeploy.
4. Verify the domain in Resend. Then set `EMAIL_FROM` (e.g. `Mod Labs <leads@yourdomain.com>`)
   as a Worker var, and emails can go to any inbox.

## Project docs
- `docs/brief.md`: requirements
- `docs/spec.md`: pages, journeys, contracts, design
- `docs/research.md`: why this stack
- `docs/progress.md`: status log
