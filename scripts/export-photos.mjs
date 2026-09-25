// One-time photo export: curated originals -> src/assets/gallery/<category>/<project>-NN.jpg
// Bakes in EXIF rotation, caps the long edge at 2048px, re-encodes, and strips ALL metadata
// (incl. GPS). Also writes src/data/photos.generated.json for the gallery data layer.
// Usage: npm run photos   (re-run safe; overwrites outputs)
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const curation = JSON.parse(await fs.readFile(path.join(root, "docs/gallery-curation.json"), "utf8"));
const sources = JSON.parse(await fs.readFile(path.join(root, "scripts/photo-sources.json"), "utf8"));
const outDir = path.join(root, "src/assets/gallery");

// id -> project slug (first project that lists it)
const projectOf = new Map();
for (const [slug, p] of Object.entries(curation.projects)) {
  for (const id of p.ids) if (!projectOf.has(id)) projectOf.set(id, slug);
}

await fs.rm(outDir, { recursive: true, force: true });
const records = [];
const counters = new Map();

for (const [category, cat] of Object.entries(curation.categories)) {
  await fs.mkdir(path.join(outDir, category), { recursive: true });
  for (const [order, id] of cat.ids.entries()) {
    const src = sources[id];
    if (!src) throw new Error(`No source path for photo id ${id}`);
    const project = projectOf.get(id) ?? `${category}-misc`;
    const n = (counters.get(project) ?? 0) + 1;
    counters.set(project, n);
    const file = `${project}-${String(n).padStart(2, "0")}.jpg`;
    const dest = path.join(outDir, category, file);

    // sharp drops metadata unless .withMetadata()/.keepMetadata() is called
    const info = await sharp(src)
      .rotate()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(dest);

    records.push({ id, category, project, order, file: `${category}/${file}`, width: info.width, height: info.height });
  }
  console.log(`${category}: ${cat.ids.length} photos`);
}

await fs.mkdir(path.join(root, "src/data"), { recursive: true });
await fs.writeFile(path.join(root, "src/data/photos.generated.json"), JSON.stringify(records, null, 1) + "\n");

// Verify: no EXIF survived
let leaked = 0;
for (const r of records) {
  const meta = await sharp(path.join(outDir, r.file)).metadata();
  if (meta.exif || meta.xmp || meta.iptc) leaked++;
}
const bytes = (await Promise.all(records.map((r) => fs.stat(path.join(outDir, r.file))))).reduce((s, st) => s + st.size, 0);
console.log(`exported ${records.length} photos, ${(bytes / 1e6).toFixed(1)} MB, files with metadata: ${leaked}`);
if (leaked) process.exit(1);
