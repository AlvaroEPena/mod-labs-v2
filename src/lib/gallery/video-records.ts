/**
 * The contract for `src/data/videos.json`, the source of truth for gallery videos (files live in
 * `public/media/`). Shared by the site build (`src/data/gallery.ts`), the local admin (`admin/`)
 * and tests. Import-free and erasable-only TypeScript, so Node can run it directly.
 */

/** One video. Array order = display order within its project. */
export type VideoRecord = {
  id: number;
  /** file name in public/media/: `v<id, 4+ digits>.mp4` for uploads (older files keep their name) */
  file: string;
  project: string;
  /** accessible name + caption on the site */
  title: string;
  /** photo shown before playback; omitted = the project's cover photo */
  posterId?: number;
};

export const MAX_VIDEO_ID = 9_999_999;
export const MAX_TITLE_LENGTH = 120;
/** Cloudflare rejects static assets over 25 MiB per file; stay safely under it. */
export const MAX_VIDEO_BYTES = 24 * 1024 * 1024;

export const isVideoId = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_VIDEO_ID;

/** File name for a new upload, e.g. 7 → "v0007.mp4". Ids are never reused. */
export const videoFileForId = (id: number) => `v${String(id).padStart(4, "0")}.mp4`;

/** A plain file name in public/media (no folders, no dot-files, .mp4 only). */
export const isSafeVideoFile = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,80}\.mp4$/i.test(value) && !value.includes("..");

/** Public URL of a video file. */
export const videoSrc = (file: string) => `/media/${file}`;

/**
 * Normalize a title: trimmed, inner whitespace collapsed. Returns null (with a reason) if it's
 * empty, too long, or contains control characters.
 */
export function cleanTitle(value: unknown): { ok: true; title: string } | { ok: false; reason: string } {
  if (typeof value !== "string") return { ok: false, reason: "Give the video a title." };
  const title = value.replace(/\s+/g, " ").trim();
  if (!title) return { ok: false, reason: "Give the video a title." };
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, reason: `Keep the title to ${MAX_TITLE_LENGTH} characters or fewer.` };
  }
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(title))
    return { ok: false, reason: "The title has characters that aren't allowed." };
  return { ok: true, title };
}

export type VideoValidationResult = { ok: true; records: VideoRecord[] } | { ok: false; problems: string[] };

type VideoValidationContext = {
  knownProjects: Iterable<string>;
  /** ids of photos that exist (posters must point at one) */
  photoIds: Iterable<number>;
  /** optional file check (the site build passes one; the admin doesn't need it) */
  fileExists?: (file: string) => boolean;
};

/** Check parsed videos.json content, reporting every problem found. */
export function validateVideoRecords(input: unknown, context: VideoValidationContext): VideoValidationResult {
  if (!Array.isArray(input)) return { ok: false, problems: ["videos.json must be a JSON array of videos."] };
  const projects = new Set(context.knownProjects);
  const photos = new Set(context.photoIds);
  const problems: string[] = [];
  const seenIds = new Set<number>();
  const seenFiles = new Set<string>();

  input.forEach((raw: unknown, index) => {
    const where = `Video #${index + 1}`;
    if (typeof raw !== "object" || raw === null) {
      problems.push(`${where} is not an object.`);
      return;
    }
    const r = raw as Record<string, unknown>;
    if (!isVideoId(r.id)) {
      problems.push(`${where} has an invalid id (${JSON.stringify(r.id)}).`);
      return;
    }
    const label = `${where} (id ${r.id})`;
    if (seenIds.has(r.id)) problems.push(`${label}: duplicate id.`);
    seenIds.add(r.id);
    if (!isSafeVideoFile(r.file)) {
      problems.push(
        `${label}: file must be a plain .mp4 name in public/media, got ${JSON.stringify(r.file)}.`,
      );
    } else {
      if (seenFiles.has(r.file.toLowerCase())) problems.push(`${label}: file ${r.file} is used twice.`);
      seenFiles.add(r.file.toLowerCase());
      if (context.fileExists && !context.fileExists(r.file))
        problems.push(`${label}: public/media/${r.file} does not exist.`);
    }
    if (typeof r.project !== "string" || !projects.has(r.project)) {
      problems.push(`${label}: unknown project ${JSON.stringify(r.project)}.`);
    }
    const title = cleanTitle(r.title);
    if (!title.ok) problems.push(`${label}: ${title.reason}`);
    else if (title.title !== r.title) problems.push(`${label}: title has extra spaces.`);
    if (r.posterId !== undefined && !(typeof r.posterId === "number" && photos.has(r.posterId))) {
      problems.push(
        `${label}: posterId ${JSON.stringify(r.posterId)} is not an existing photo (remove it to use the cover).`,
      );
    }
  });

  if (problems.length) return { ok: false, problems };
  return { ok: true, records: (input as VideoRecord[]).map(toVideoRecord) };
}

/** Normalize key order (dropping unknown keys) so the file always serializes the same way. */
const toVideoRecord = (r: VideoRecord): VideoRecord => ({
  id: r.id,
  file: r.file,
  project: r.project,
  title: r.title,
  ...(r.posterId === undefined ? {} : { posterId: r.posterId }),
});

/** Stable videos.json text: one video per line (same style as photos.json). */
export function formatVideosJson(records: readonly VideoRecord[]): string {
  if (records.length === 0) return "[]\n";
  return `[\n${records.map((r) => `  ${JSON.stringify(toVideoRecord(r))}`).join(",\n")}\n]\n`;
}
