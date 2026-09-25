// Generates favicon.svg, favicon.ico, apple-touch-icon.png and og.png in public/
// from the brand SVGs in src/assets/brand. Run: node scripts/brand-assets.mjs
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const brand = (f) => path.join(root, "src/assets/brand", f);
const out = (f) => path.join(root, "public", f);

const mark = await fs.readFile(brand("mark.svg"), "utf8");
const wordmark = await fs.readFile(brand("wordmark.svg"), "utf8");
const inner = (svg) => svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

// favicon.svg: mark on a rounded dark tile so it reads on light browser chrome too
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#070815"/>
  <g transform="translate(4 4) scale(.875)">${inner(mark)}</g>
</svg>
`;
await fs.writeFile(out("favicon.svg"), faviconSvg);

// apple-touch-icon.png (180×180, opaque; iOS adds its own rounding)
const touchSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180">
  <defs><radialGradient id="bg" cx=".3" cy=".2" r="1"><stop offset="0" stop-color="#1a1f55"/><stop offset="1" stop-color="#070815"/></radialGradient></defs>
  <rect width="180" height="180" fill="url(#bg)"/>
  <g transform="translate(30 30) scale(1.875)">${inner(mark)}</g>
</svg>`;
await sharp(Buffer.from(touchSvg)).png().toFile(out("apple-touch-icon.png"));

// favicon.ico: 32px + 16px PNG-encoded entries
const icoSizes = [16, 32, 48];
const pngs = await Promise.all(icoSizes.map((s) => sharp(Buffer.from(faviconSvg), { density: 384 }).resize(s, s).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach((png, i) => {
  const e = 6 + i * 16;
  const s = icoSizes[i];
  header.writeUInt8(s === 256 ? 0 : s, e);
  header.writeUInt8(s === 256 ? 0 : s, e + 1);
  header.writeUInt8(0, e + 2);
  header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(png.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
await fs.writeFile(out("favicon.ico"), Buffer.concat([header, ...pngs]));

// og.png 1200×630: logo lockup on the neon lab background with circuit traces
const traces = [
  "M0 120h180l40 40h160",
  "M0 520h140l60-60h120l30 30h90",
  "M1200 90h-200l-50 50H800",
  "M1200 540h-160l-40-40H860l-30 30h-60",
  "M1200 300h-120l-30-30h-80",
  "M0 330h90l30 30h70",
];
const pads = [
  [380, 160], [410, 490], [800, 140], [770, 530], [970, 270], [190, 360],
];
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <radialGradient id="g1" cx=".85" cy="0" r=".8"><stop offset="0" stop-color="#a855f7" stop-opacity=".45"/><stop offset="1" stop-color="#a855f7" stop-opacity="0"/></radialGradient>
    <radialGradient id="g2" cx=".05" cy=".2" r=".7"><stop offset="0" stop-color="#00e5ff" stop-opacity=".3"/><stop offset="1" stop-color="#00e5ff" stop-opacity="0"/></radialGradient>
    <radialGradient id="g3" cx=".5" cy="1.1" r=".6"><stop offset="0" stop-color="#ff3df2" stop-opacity=".22"/><stop offset="1" stop-color="#ff3df2" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M32 0H0v32" fill="none" stroke="#7890ff" stroke-opacity=".08"/>
      <circle cx="0" cy="0" r="1.3" fill="#00e5ff" fill-opacity=".22"/>
    </pattern>
    <linearGradient id="tr" x1="0" x2="1"><stop offset="0" stop-color="#00e5ff"/><stop offset="1" stop-color="#a855f7"/></linearGradient>
    <filter id="glow" x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="1200" height="630" fill="#070815"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <rect width="1200" height="630" fill="url(#g1)"/>
  <rect width="1200" height="630" fill="url(#g2)"/>
  <rect width="1200" height="630" fill="url(#g3)"/>
  <g fill="none" stroke="url(#tr)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".7" filter="url(#glow)">
    ${traces.map((d) => `<path d="${d}"/>`).join("")}
  </g>
  ${pads.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="#070815" stroke="#00e5ff" stroke-width="3"/>`).join("")}
  <g transform="translate(300 175) scale(3)" filter="url(#glow)">${inner(mark)}</g>
  <g transform="translate(530 212) scale(1.92)" filter="url(#glow)">${inner(wordmark)}</g>
  <text x="532" y="330" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="30" font-weight="600" fill="#b2b8df" letter-spacing="1">Console modding &amp; repair · Seattle</text>
  <text x="532" y="382" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="24" fill="#8e95c4">Switch modchips · Xbox 360 RGH · Custom builds</text>
</svg>`;
await sharp(Buffer.from(ogSvg)).png({ compressionLevel: 9, palette: false }).toFile(out("og.png"));

console.log("brand assets written: favicon.svg, favicon.ico, apple-touch-icon.png, og.png");
