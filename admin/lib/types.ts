/**
 * The admin HTTP API contract, shared by the server (admin/*.ts) and the browser UI
 * (admin/public/*.js imports these via JSDoc). Types only: nothing here exists at runtime.
 */
import type { PhotoRecord } from "../../src/lib/gallery/records.ts";
import type { VideoRecord } from "../../src/lib/gallery/video-records.ts";

export type { PhotoRecord };

export type AdminCategory = { slug: string; title: string };
export type AdminProject = { slug: string; title: string; category: string };
export type AdminPhoto = PhotoRecord & { category: string };

/** A deleted photo waiting in `.admin-trash/`. */
export type TrashEntry = {
  record: PhotoRecord;
  deletedAt: string;
  /** The photo that came right before it in its project when deleted (null = it was the cover). */
  afterId: number | null;
  /** Its index in photos.json when deleted (it goes back exactly there if nothing changed). */
  index: number;
  /** Videos that used it as their poster (they switch to "auto" while it's deleted, and back on restore). */
  posterOf?: number[];
};
export type TrashItem = PhotoRecord & { deletedAt: string };

/** Uncommitted changes under the gallery paths (`count` is null when git couldn't be asked). */
export type PendingChanges = { count: number } | { count: null; reason: string };

export type UploadLimits = { maxUploadBytes: number; acceptedTypes: string[] };

export type AdminState = {
  categories: AdminCategory[];
  projects: AdminProject[];
  /** display order: array order within each project, first photo = project cover */
  photos: AdminPhoto[];
  /** newest first */
  trash: TrashItem[];
  /** display order within each project */
  videos: AdminVideo[];
  /** newest first */
  videoTrash: VideoTrashItem[];
  pending: PendingChanges;
  limits: UploadLimits;
  videoLimits: VideoLimits;
};

/** POST /api/move: put photos (any projects) into `project`, before `beforeId` or at the end (null). */
export type MoveBody = { ids: number[]; project: string; beforeId: number | null };
/** POST /api/arrange: exact contents + order of some projects (undo of a move or drag). */
export type ArrangeBody = { layout: Record<string, number[]> };
/** POST /api/delete and /api/restore. */
export type IdsBody = { ids: number[] };

export type UploadResult = { state: AdminState; photo: AdminPhoto };

export type ApiError = { error: string; message: string };

/* ---------- videos ---------- */

export type { VideoRecord };

/** A video as the admin shows it. */
export type AdminVideo = VideoRecord & {
  category: string;
  /** photo shown as the poster: posterId while it's in the project, else the project cover (null = none) */
  posterThumbId: number | null;
};

/** A deleted video waiting in `.admin-trash/` (listed in .admin-trash/videos.json). */
export type VideoTrashEntry = {
  record: VideoRecord;
  deletedAt: string;
  afterId: number | null;
  index: number;
};
export type VideoTrashItem = VideoRecord & { deletedAt: string };

export type VideoLimits = { maxUploadBytes: number; maxDurationSeconds: number; acceptedTypes: string[] };

/** POST /api/videos/update: new title and/or poster (null = auto, the project cover). */
export type VideoUpdateBody = { id: number; title?: string; posterId?: number | null };

/** A video upload being processed in the background (poll GET /api/videos/jobs/:id). */
export type VideoJob = {
  id: string;
  state: "queued" | "processing" | "done" | "error";
  /** what's happening now, e.g. "Converting" */
  stage: string;
  /** 0–1 within the current stage */
  progress: number;
  fileName: string;
  project: string;
  message?: string;
  video?: AdminVideo;
};
