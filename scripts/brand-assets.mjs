// Generates favicon.svg, favicon.ico, apple-touch-icon.png and og.png in public/ from the brand SVGs in
// src/assets/brand (the same files the site inlines). Run after changing the logo: node scripts/brand-assets.mjs
//  - favicons use mark-small.svg: an optical size drawn for 16-32px (fewer pins, solid flask)
//  - the touch icon and the OG card use the full mark.svg
// The OG tagline is set in Segoe UI (Windows), falling back to Helvetica/Arial; the PNG is committed, so the
// font only matters on the machine that regenerates it.
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const brand = (f) => fs.readFile(path.join(root, "src/assets/brand", f), "utf8");
const out = (f) => path.join(root, "public", f);

const INK = "#05070e";
const [mark, markSmall, wordmark] = await Promise.all([brand("mark.svg"), brand("mark-small.svg"), brand("wordmark.svg")]);
/** inner markup of an SVG file, with its ids prefixed so several copies can share one document */
const inner = (svg, prefix) =>
  svg
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/id="([^"]+)"/g, `id="${prefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`);

/* ---------- favicon.svg: small mark on a dark rounded tile (reads on light browser chrome too) ---------- */
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="${INK}"/>
  <g transform="translate(1 1) scale(.9375)">${inner(markSmall, "f")}</g>
</svg>
`;
await fs.writeFile(out("favicon.svg"), faviconSvg);

/* ---------- favicon.ico: 16, 32 and 48px PNG-encoded entries ---------- */
const icoSizes = [16, 32, 48];
const pngs = await Promise.all(
  icoSizes.map((s) => sharp(Buffer.from(faviconSvg), { density: 1200 }).resize(s, s).png().toBuffer()),
);
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach((png, i) => {
  const e = 6 + i * 16;
  const s = icoSizes[i];
  header.writeUInt8(s, e);
  header.writeUInt8(s, e + 1);
  header.writeUInt8(0, e + 2); // palette
  header.writeUInt8(0, e + 3); // reserved
  header.writeUInt16LE(1, e + 4); // colour planes
  header.writeUInt16LE(32, e + 6); // bits per pixel
  header.writeUInt32LE(png.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
await fs.writeFile(out("favicon.ico"), Buffer.concat([header, ...pngs]));

/* ---------- apple-touch-icon.png: 180x180, opaque (iOS rounds the corners itself) ---------- */
const touchSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180">
  <defs>
    <radialGradient id="bg" cx=".3" cy=".15" r="1"><stop offset="0" stop-color="#12233a"/><stop offset=".6" stop-color="#080b16"/><stop offset="1" stop-color="${INK}"/></radialGradient>
    <radialGradient id="glow" cx=".5" cy=".55" r=".45"><stop offset="0" stop-color="#4ee0ef" stop-opacity=".22"/><stop offset="1" stop-color="#4ee0ef" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="180" height="180" fill="url(#bg)"/>
  <rect width="180" height="180" fill="url(#glow)"/>
  <g transform="translate(26 26) scale(2)">${inner(mark, "t")}</g>
</svg>`;
await sharp(Buffer.from(touchSvg)).png().toFile(out("apple-touch-icon.png"));

/* ---------- og.png 1200x630: the mark in a glass frame, wired into circuit traces, beside the lockup ---------- */
// Frame: 260x260 at (110, 185). Traces leave its edges and end in vias (same motif as the home hero).
const traces = [
  "M110 245H64L36 217H0",
  "M110 315H52L24 343",
  "M110 385H78L50 413V470L22 498H0",
  "M180 185V130L206 104V0",
  "M300 185V146L326 120H420L448 92H1200",
  "M240 445V500L214 526V630",
  "M300 445V488L330 518H520L548 546H760",
  "M1200 560H1010L982 532H900",
];
const vias = [[0, 245], [24, 343], [22, 498], [206, 104], [448, 92], [214, 526], [548, 546], [900, 532]];
const pads = [[110, 245], [110, 315], [110, 385], [180, 185], [300, 185], [240, 445], [300, 445]];
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <radialGradient id="a1" cx="240" cy="300" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4ee0ef" stop-opacity=".2"/><stop offset="1" stop-color="#4ee0ef" stop-opacity="0"/></radialGradient>
    <radialGradient id="a2" cx="1120" cy="40" r="560" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#6e64f0" stop-opacity=".2"/><stop offset="1" stop-color="#6e64f0" stop-opacity="0"/></radialGradient>
    <radialGradient id="a3" cx="760" cy="700" r="460" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4ee0ef" stop-opacity=".09"/><stop offset="1" stop-color="#4ee0ef" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0v40" fill="none" stroke="#ffffff" stroke-opacity=".035"/>
      <circle cx="0" cy="0" r="1.2" fill="#4ee0ef" fill-opacity=".2"/>
    </pattern>
    <radialGradient id="tr" cx="240" cy="315" r="760" gradientUnits="userSpaceOnUse"><stop offset=".2" stop-color="#4ee0ef"/><stop offset="1" stop-color="#4ee0ef" stop-opacity=".18"/></radialGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".1"/><stop offset=".55" stop-color="#ffffff" stop-opacity=".025"/></linearGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="26"/></filter>
  </defs>
  <rect width="1200" height="630" fill="${INK}"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <rect width="1200" height="630" fill="url(#a1)"/>
  <rect width="1200" height="630" fill="url(#a2)"/>
  <rect width="1200" height="630" fill="url(#a3)"/>
  <g fill="none" stroke="url(#tr)" stroke-linecap="round" stroke-linejoin="round">
    <g stroke-width="10" stroke-opacity=".1">${traces.map((d) => `<path d="${d}"/>`).join("")}</g>
    <g stroke-width="2.4">${traces.map((d) => `<path d="${d}"/>`).join("")}</g>
  </g>
  ${vias.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="${INK}" stroke="#a9f2fa" stroke-opacity=".75" stroke-width="2.4"/>`).join("")}
  ${pads.map(([x, y]) => `<rect x="${x - 9}" y="${y - 9}" width="18" height="18" rx="4.5" fill="#0d1221" stroke="#4ee0ef" stroke-width="2.4"/>`).join("")}
  <ellipse cx="240" cy="330" rx="150" ry="140" fill="#4ee0ef" fill-opacity=".18" filter="url(#soft)"/>
  <rect x="110" y="185" width="260" height="260" rx="44" fill="#0c111f" fill-opacity=".72"/>
  <rect x="110" y="185" width="260" height="260" rx="44" fill="url(#glass)" stroke="#ffffff" stroke-opacity=".12" stroke-width="1.5"/>
  <g transform="translate(144 219) scale(3)">${inner(mark, "o")}</g>
  <g transform="translate(470 222) scale(2.7)">${inner(wordmark, "w")}</g>
  <text x="472" y="356" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="40" font-weight="600" fill="#eef2fa" letter-spacing="-.5">Console modding &amp; repair in Seattle</text>
  <text x="473" y="406" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="26" fill="#a3adc4">Switch modchips, Xbox 360 RGH and hand-built consoles</text>
</svg>`;
await sharp(Buffer.from(ogSvg)).png({ compressionLevel: 9 }).toFile(out("og.png"));

console.log("brand assets written: favicon.svg, favicon.ico, apple-touch-icon.png, og.png");
