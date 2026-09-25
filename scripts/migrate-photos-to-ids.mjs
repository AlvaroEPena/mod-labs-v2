// ONE-TIME migration (spec §15): category/project-named gallery files → stable id-based names.
//   src/assets/gallery/<category>/<project>-NN.jpg  →  src/assets/gallery/photos/pNNNN.jpg
//   src/data/photos.generated.json                  →  src/data/photos.json (source of truth)
// Files are moved byte-for-byte (no re-encode), display order is kept, and the result is
// verified (same photos, dimensions match, no EXIF/GPS). Safe to re-run: exits if already done.
// Usage: node scripts/migrate-photos-to-ids.mjs
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { projects } from "../src/data/projects.ts";
import {
  formatPhotosJson,
  groupByProject,
  photoFileForId,
  validatePhotoRecords,
} from "../src/lib/gallery/records.ts";
import { hasMetadata } from "./lib/process-photo.mjs";

const root = path.resolve(import.meta.dirname, "..");
const galleryDir = path.join(root, "src/assets/gallery");
const legacyJson = path.join(root, "src/data/photos.generated.json");
const photosJson = path.join(root, "src/data/photos.json");

if (!existsSync(legacyJson)) {
  console.log(
    existsSync(photosJson) ? "Already migrated: src/data/photos.json exists." : "Nothing to migrate.",
  );
  process.exit(0);
}

/** @type {{ id: number; category: string; project: string; file: string; width: number; height: number }[]} */
const legacy = JSON.parse(await fs.readFile(legacyJson, "utf8"));
const records = legacy.map((r) => ({
  id: r.id,
  file: photoFileForId(r.id),
  project: r.project,
  width: r.width,
  height: r.height,
}));

const check = validatePhotoRecords(
  records,
  projects.map((p) => p.slug),
);
if (!check.ok) throw new Error(`Refusing to migrate:\n- ${check.problems.join("\n- ")}`);

// Pre-flight: every source exists and no target would be overwritten.
for (const [i, r] of legacy.entries()) {
  if (!existsSync(path.join(galleryDir, r.file))) throw new Error(`Missing source ${r.file}`);
  if (existsSync(path.join(galleryDir, records[i].file)))
    throw new Error(`Target already exists: ${records[i].file}`);
}

await fs.mkdir(path.join(galleryDir, "photos"), { recursive: true });
for (const [i, r] of legacy.entries()) {
  await fs.rename(path.join(galleryDir, r.file), path.join(galleryDir, records[i].file));
}
// Canonical order: grouped by project (projects.ts order), each project in its display order.
await fs.writeFile(
  photosJson,
  formatPhotosJson(
    groupByProject(
      records,
      projects.map((p) => p.slug),
    ),
  ),
);
await fs.rm(legacyJson);

// Old category folders must now be empty; remove them (rmdir fails loudly if not).
for (const category of new Set(legacy.map((r) => r.category))) {
  await fs.rmdir(path.join(galleryDir, category));
}

// Verify the result against the pre-migration data.
const written = JSON.parse(await fs.readFile(photosJson, "utf8"));
const problems = [];
if (written.length !== legacy.length) problems.push(`count ${written.length} != ${legacy.length}`);
let withMetadata = 0;
const orderOf = (list, project) =>
  list
    .filter((r) => r.project === project)
    .map((r) => r.id)
    .join(",");
for (const p of projects) {
  if (orderOf(written, p.slug) !== orderOf(legacy, p.slug))
    problems.push(`display order changed in ${p.slug}`);
}
for (const r of written) {
  const abs = path.join(galleryDir, r.file);
  const meta = await sharp(abs).metadata();
  if (meta.width !== r.width || meta.height !== r.height) problems.push(`${r.file}: size mismatch`);
  if (await hasMetadata(abs)) withMetadata++;
}
const onDisk = (await fs.readdir(path.join(galleryDir, "photos"))).filter((f) => f.endsWith(".jpg")).length;
if (onDisk !== legacy.length) problems.push(`${onDisk} files on disk, expected ${legacy.length}`);
if (withMetadata) problems.push(`${withMetadata} files still carry metadata`);

console.log(
  `Migrated ${written.length} photos to src/assets/gallery/photos/, files with metadata: ${withMetadata}`,
);
if (problems.length) {
  console.error(`Verification FAILED:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("Verification passed: same photos, same order per project, same dimensions, no EXIF.");
