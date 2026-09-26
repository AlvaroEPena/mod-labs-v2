/**
 * The contract for `src/data/photos.json`, the source of truth for gallery photos.
 * Shared by the site build (`src/data/gallery.ts`), the local photo admin (`admin/`) and the
 * one-time migration script, so it has no imports and uses only erasable TypeScript
 * (Node runs it directly with type stripping).
 */

/** One photo. Array order in photos.json = display order within its project (first = cover). */
export type PhotoRecord = {
  id: number;
  /** relative to src/assets/gallery; always `photos/p<id, 4+ digits>.jpg` */
  file: string;
  project: string;
  width: number;
  height: number;
};

export const MAX_PHOTO_ID = 9_999_999;

export const isPhotoId = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PHOTO_ID;

/** File name for an id, e.g. 7 → "p0007.jpg". Ids are never reused, so names are stable. */
export const photoFileName = (id: number) => `p${String(id).padStart(4, "0")}.jpg`;
export const photoFileForId = (id: number) => `photos/${photoFileName(id)}`;

const isPositiveInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

export type ValidationResult = { ok: true; records: PhotoRecord[] } | { ok: false; problems: string[] };

/**
 * Check parsed photos.json content. Returns every problem found (not just the first) so a
 * broken file can be fixed in one go.
 */
export function validatePhotoRecords(input: unknown, knownProjects: Iterable<string>): ValidationResult {
  if (!Array.isArray(input)) return { ok: false, problems: ["photos.json must be a JSON array of photos."] };
  const projects = new Set(knownProjects);
  const problems: string[] = [];
  const seenIds = new Set<number>();

  input.forEach((raw: unknown, index) => {
    const where = `Entry #${index + 1}`;
    if (typeof raw !== "object" || raw === null) {
      problems.push(`${where} is not an object.`);
      return;
    }
    const r = raw as Record<string, unknown>;
    if (!isPhotoId(r.id)) {
      problems.push(`${where} has an invalid id (${JSON.stringify(r.id)}).`);
      return;
    }
    const label = `${where} (id ${r.id})`;
    if (seenIds.has(r.id)) problems.push(`${label}: duplicate id.`);
    seenIds.add(r.id);
    if (r.file !== photoFileForId(r.id))
      problems.push(`${label}: file must be "${photoFileForId(r.id)}", got ${JSON.stringify(r.file)}.`);
    if (typeof r.project !== "string" || !projects.has(r.project)) {
      problems.push(
        `${label}: unknown project ${JSON.stringify(r.project)}. Known: ${[...projects].join(", ")}.`,
      );
    }
    if (!isPositiveInt(r.width) || !isPositiveInt(r.height))
      problems.push(`${label}: width/height must be positive integers.`);
  });

  if (problems.length) return { ok: false, problems };
  return { ok: true, records: (input as PhotoRecord[]).map(toRecord) };
}

/** Normalize key order (and drop unknown keys) so the file always serializes the same way. */
const toRecord = (r: PhotoRecord): PhotoRecord => ({
  id: r.id,
  file: r.file,
  project: r.project,
  width: r.width,
  height: r.height,
});

/**
 * Canonical order: grouped by project (in `projectOrder`), each project's photos kept in their
 * display order (the sort is stable). The file is then fully determined by each project's order,
 * so undoing a change (move a photo out and back, delete then restore) gives identical bytes.
 */
export function groupByProject<T extends { project: string }>(
  records: readonly T[],
  projectOrder: readonly string[],
): T[] {
  const rank = new Map(projectOrder.map((slug, i) => [slug, i]));
  const rankOf = (r: T) => rank.get(r.project) ?? projectOrder.length;
  return [...records].sort((a, b) => rankOf(a) - rankOf(b));
}

/**
 * Stable photos.json text: one photo per line, so a reorder or move shows up in git as a few
 * moved lines instead of a wall of changes.
 */
export function formatPhotosJson(records: readonly PhotoRecord[]): string {
  if (records.length === 0) return "[]\n";
  return `[\n${records.map((r) => `  ${JSON.stringify(toRecord(r))}`).join(",\n")}\n]\n`;
}
