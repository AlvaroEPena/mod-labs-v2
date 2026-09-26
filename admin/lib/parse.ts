/**
 * Request body parsing: the only way request data reaches the operations. Anything unexpected
 * is a 400 with a plain-language message; ids and project slugs are checked against the rules
 * (never used as paths).
 */
import { projects } from "../../src/data/projects.ts";
import { isPhotoId } from "../../src/lib/gallery/records.ts";
import { cleanTitle } from "../../src/lib/gallery/video-records.ts";
import { HttpError } from "./http.ts";
import type { ArrangeBody, IdsBody, MoveBody, VideoUpdateBody } from "./types.ts";

/** More than the whole gallery; keeps a hostile body from doing silly amounts of work. */
export const MAX_BATCH = 2000;

const knownProjects = new Set<string>(projects.map((p) => p.slug));

const badRequest = (message: string) => new HttpError(400, "invalid", message);

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw badRequest("Expected a JSON object.");
  return body as Record<string, unknown>;
}

export function parseId(value: unknown): number {
  if (!isPhotoId(value)) throw badRequest("That isn't a valid photo id.");
  return value;
}

export function parseProject(value: unknown): string {
  if (typeof value !== "string" || !knownProjects.has(value))
    throw badRequest("Pick one of the gallery projects.");
  return value;
}

/** A non-empty list of distinct photo ids. */
export function parseIds(value: unknown, { allowEmpty = false } = {}): number[] {
  if (!Array.isArray(value) || value.length > MAX_BATCH) throw badRequest("Expected a list of photo ids.");
  const ids = value.map(parseId);
  if (!allowEmpty && ids.length === 0) throw badRequest("Choose at least one photo.");
  if (new Set(ids).size !== ids.length) throw badRequest("Each photo can only be listed once.");
  return ids;
}

export const parseIdsBody = (body: unknown): IdsBody => ({ ids: parseIds(asObject(body).ids) });

export function parseMoveBody(body: unknown): MoveBody {
  const o = asObject(body);
  const beforeId = o.beforeId === undefined || o.beforeId === null ? null : parseId(o.beforeId);
  return { ids: parseIds(o.ids), project: parseProject(o.project), beforeId };
}

export function parseArrangeBody(body: unknown): ArrangeBody {
  const layout = asObject(asObject(body).layout);
  const entries = Object.entries(layout);
  if (entries.length === 0) throw badRequest("Expected at least one project.");
  // A project can be emptied by a move, so its list may be empty.
  return {
    layout: Object.fromEntries(
      entries.map(([slug, ids]) => [parseProject(slug), parseIds(ids, { allowEmpty: true })]),
    ),
  };
}

/* ---------- videos ---------- */

export function parseTitle(value: unknown): string {
  const result = cleanTitle(value);
  if (!result.ok) throw badRequest(result.reason);
  return result.title;
}

/** POST /api/videos/update: at least one of title / posterId (null = auto). */
export function parseVideoUpdateBody(body: unknown): VideoUpdateBody {
  const o = asObject(body);
  const update: VideoUpdateBody = { id: parseId(o.id) };
  if (o.title !== undefined) update.title = parseTitle(o.title);
  if (o.posterId !== undefined) update.posterId = o.posterId === null ? null : parseId(o.posterId);
  if (update.title === undefined && update.posterId === undefined) throw badRequest("Nothing to change.");
  return update;
}

/**
 * Video uploads send the raw file as the body; the rest travels in the query string:
 * `project`, `title`, and `name` (the original file name, shown in messages only).
 */
export function parseVideoUploadQuery(url: URL): { project: string; title: string; fileName: string } {
  const fileName =
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    (url.searchParams.get("name") ?? "video").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) || "video";
  return {
    project: parseProject(url.searchParams.get("project")),
    title: parseTitle(url.searchParams.get("title")),
    fileName,
  };
}
