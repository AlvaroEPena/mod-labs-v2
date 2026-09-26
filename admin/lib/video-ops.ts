/**
 * Pure operations specific to videos (ordering, moving, deleting and restoring use the shared
 * list-ops). No I/O; each returns new arrays.
 */
import type { VideoRecord } from "../../src/lib/gallery/video-records.ts";
import { ListError, type Item } from "./list-ops.ts";

export type VideoChanges = { title?: string; posterId?: number | null };

/**
 * Change a video's title and/or poster. `posterId: null` means "auto" (the project cover); a
 * number must be a photo in the video's own project (`projectPhotoIds`).
 */
export function updateVideo(
  list: readonly VideoRecord[],
  id: number,
  changes: VideoChanges,
  projectPhotoIds: (project: string) => readonly number[],
): VideoRecord[] {
  const index = list.findIndex((v) => v.id === id);
  if (index === -1)
    throw new ListError("not_found", "That video isn't in the gallery any more. Reload the page.");
  const { posterId: currentPoster, ...base } = list[index];
  let posterId = currentPoster;
  if (changes.posterId === null) posterId = undefined;
  else if (changes.posterId !== undefined) {
    if (!projectPhotoIds(base.project).includes(changes.posterId)) {
      throw new ListError("invalid", "Pick a poster from this project's photos.");
    }
    posterId = changes.posterId;
  }
  const next: VideoRecord = {
    ...base,
    title: changes.title ?? base.title,
    ...(posterId === undefined ? {} : { posterId }),
  };
  return list.map((v, i) => (i === index ? next : v));
}

/**
 * Photos are being deleted: videos using one of them as poster switch to "auto". Returns the new
 * list and, per photo id, which videos used it (so a restore can put the poster back).
 */
export function clearPosters(
  list: readonly VideoRecord[],
  photoIds: readonly number[],
): { list: VideoRecord[]; posterOf: Map<number, number[]> } {
  const gone = new Set(photoIds);
  const posterOf = new Map<number, number[]>();
  const next = list.map((v) => {
    if (v.posterId === undefined || !gone.has(v.posterId)) return v;
    posterOf.set(v.posterId, [...(posterOf.get(v.posterId) ?? []), v.id]);
    const { posterId: _removed, ...rest } = v;
    return rest;
  });
  return { list: next, posterOf };
}

/** Photos came back from the trash: re-link them as posters of videos that are still on "auto". */
export function relinkPosters(
  list: readonly VideoRecord[],
  links: ReadonlyMap<number, readonly number[]>,
): VideoRecord[] {
  const posterFor = new Map<number, number>();
  for (const [photoId, videoIds] of links) for (const videoId of videoIds) posterFor.set(videoId, photoId);
  return list.map((v) => {
    const photoId = posterFor.get(v.id);
    return photoId !== undefined && v.posterId === undefined ? { ...v, posterId: photoId } : v;
  });
}

/**
 * The photo the site shows as poster, mirroring picks.ts videoPoster(): posterId while that photo
 * is in the video's project, else the project's cover (first photo). Null if the project has none.
 */
export function posterThumbId(video: VideoRecord, photos: readonly Item[]): number | null {
  const chosen = photos.find((p) => p.id === video.posterId && p.project === video.project);
  return chosen?.id ?? photos.find((p) => p.project === video.project)?.id ?? null;
}
