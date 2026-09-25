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
| `npm run photos` | Re-exports the curated gallery photos (resizes them and strips EXIF/GPS). Run it only after changing `docs/gallery-curation.json`. |
| `npm run deploy` | Runs the safety checks, builds and deploys to Cloudflare. See the checklist below. |

## Editing content
All the text lives in `src/data/`:
- `services.ts`: prices and what's included
- `builds.ts`: the GWii and Wii Miicro commissions
- `gallery.ts`: categories and project write-ups
- `faq.ts`: the FAQ
- `reviews.ts`: **real** reviews only. The section stays hidden while this is empty.
- `site.ts`: social links. Empty links stay hidden.

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
