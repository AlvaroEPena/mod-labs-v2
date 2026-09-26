# Mod Labs — Brief
_Mode: refactor (full rebuild) · Created: 2026-09-24_

## Pitch
"Rebuild this site as completely new, using new technologies and something that would pop
out to people and be good … modern, fast and smooth on all platforms, no chunky loading."
Mod Labs is Alvaro's one-person console modding & electronics repair shop in Seattle.

## Type & audience
- Site type: marketing / service-business site with request forms and a photo gallery
- Primary audience: gamers and console owners (Seattle locals first, mail-in customers too),
  many non-technical ("noob friendly"), mostly arriving on phones
- Devices: mobile-first, must be flawless on phones; also desktop

## Goals
- Primary goal: turn visitors into service requests / quote requests
- Success: the site looks premium and trustworthy, loads instantly, and the gallery shows off
  real work quality

## Content & accounts
- Who edits content: Alvaro (developer-comfortable); content in code/data files is fine
- Accounts / roles: none (fully public site)

## Required features (MVP)
- Pages: Home, Services & pricing, Gallery (categorized), About, Book a service, Request a
  quote/repair, FAQ, Privacy, Terms, 404
- Services & prices (unchanged): Xbox 360 RGH $100 (phat RGH1.2 modchip / slim RGH3);
  Switch OLED Kamikaze $160; Switch v1/v2 $120; Switch Lite $140; repairs, PS4 PPPwn
  internal installs, custom shells & custom builds by quote
- **Custom build commissions** section (new):
  - **Wii Miicro Deluxe — $450** (pink/blue fade square console). Ultra-compact real-Wii build:
    HDMI output (VGA patches + analog→HDMI converter), USB-C PD power (5V/15W min to boot;
    12V PD recommended for sensor bar), 128GB USB storage, MX chip relocation (RTC works),
    Bluetooth relocation (Wiimotes pair normally). Includes console + 20W USB-C PD brick +
    128GB USB drive; no controllers/cables/sensor bar. Hand-built: micro-soldering, board
    trimming, chip relocation, tuning. (Source: Alvaro's FB Marketplace listing, listed there at $400;
    Alvaro set $450 for the site.)
  - **GWii Portable Handheld Wii — $900**. Real Wii motherboard trimmed for handheld play, no
    emulation; plays Wii + GameCube natively; USB-C PD charging; 128GB internal storage
    (upgradeable microSD); smart USB drive switching (plug into PC to manage files); VGA
    video to built-in display; built-in speakers + 3.5mm jack; volume & screen controls;
    battery monitoring (software indicator + LEDs); temperature readout. Hand-crafted, long build.
  - Both: commission/made-to-order → "Request this build" CTA to the quote form. Game preloads
    NOT mentioned (same policy as below). Related gallery projects: G-boy (#1), G-Wii (#2).
- Forms to email (free service): booking request (service checkboxes, delivery method,
  message) and quote request (request type, message, photo upload). AJAX submit, instant
  confirmation, spam protection
- Service area: Seattle local drop-off (fast turnaround, often same day) + mail-in available
  ("contact me and we'll work out the details")
- "How it works" steps section
- FAQ section/page
- Reviews/testimonials section — only real reviews supplied by Alvaro (none fabricated)
- Contact: Instagram section (account coming later → placeholder, easy to fill in), TikTok,
  Discord, email/forms
- Gallery: curated from ~451 photos in `C:\Users\Alvaro\Desktop\ModdingWebsiteImages` + the 54
  images on the old site; de-duplicated; organized by category (e.g. Nintendo Switch
  Modchips, Xbox 360 RGH, PlayStation, Custom Builds & Portables, Repairs). Keep the 11
  existing project write-ups
- Video: only the video(s) already on the old site (`project4.1.mp4`); no album videos
- New logo + favicon + OG image and visual "eye candy" (Alvaro gave free rein)

## Nice-to-have (later)
- Custom domain; Instagram feed once account exists; calendar booking

## Constraints
- Hosting / budget: every technology must be free; free subdomain for now (old site used
  mod-labs-website.vercel.app)
- Tech preferences: none — "use whatever you think is appropriate"; any tech can be replaced
- Compliance: not advertising game libraries/"game archives" (copyright). Software setup
  (homebrew, emuNAND, Aurora) is described
- Performance: "no chunky loading" → tiny JS, optimized responsive images, smooth motion,
  respects reduced-motion

## Design
- Direction: **Premium neon lab** — keep dark theme with cyan (#00e5ff) / purple (#a855f7) /
  magenta (#ff3df2) neon, but far more polished: circuit-trace details, glow, bold type,
  smooth animation
- Brand: keep the name "Mod Labs"; new logo
- Tone: personal, friendly, confident, noob-friendly, first person ("I")

## Refactor notes
- Source: `C:\Users\Alvaro\Desktop\ModdingWebsiteProject` (Astro 6 + Bootstrap 5 + AOS +
  Formspree; GitHub `AlvaroEPena/mod-labs-website`, deployed on Vercel)
- Why: wants a completely new, standout, faster, smoother site
- Preserve: business content, prices, project write-ups, about text, vetted video
- Where: build fresh in `web-dev-agent/sites/mod-labs/`; the old project and the photo album
  folder are left untouched (duplicates are excluded from the new site, not deleted
  from disk)

## Open questions (user said "go" — using these defaults until answered)
- Reviews: none supplied yet → build section driven by a data file; hidden while empty
- Discord / TikTok / Instagram: placeholders in one config file, hidden until filled
- Public email: none → forms only
- Form backend: research picks the best free option (Formspree status unknown)
