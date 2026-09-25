/**
 * The admin HTTP API contract, shared by the server (admin/*.ts) and the browser UI
 * (admin/public/*.js imports these via JSDoc). Types only: nothing here exists at runtime.
 */
import type { PhotoRecord } from "../../src/lib/gallery/records.ts";

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
  pending: PendingChanges;
  limits: UploadLimits;
};

/** POST /api/move: put photos (any projects) into `project`, before `beforeId` or at the end (null). */
export type MoveBody = { ids: number[]; project: string; beforeId: number | null };
/** POST /api/arrange: exact contents + order of some projects (undo of a move or drag). */
export type ArrangeBody = { layout: Record<string, number[]> };
/** POST /api/delete and /api/restore. */
export type IdsBody = { ids: number[] };

export type UploadResult = { state: AdminState; photo: AdminPhoto };

export type ApiError = { error: string; message: string };
