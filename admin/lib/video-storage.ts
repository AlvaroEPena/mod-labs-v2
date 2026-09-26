/**
 * Disk I/O for videos: src/data/videos.json, files in public/media/, and the video trash
 * (.admin-trash/<file> + .admin-trash/videos.json). Same rules as photo storage: atomic writes,
 * one change at a time (the shared lock), and step order that never leaves videos.json pointing
 * at a missing file.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { groupByProject } from "../../src/lib/gallery/records.ts";
import {
  formatVideosJson,
  isSafeVideoFile,
  validateVideoRecords,
  videoFileForId,
  type VideoRecord,
} from "../../src/lib/gallery/video-records.ts";
import type { AdminPaths } from "./config.ts";
import { HttpError } from "./http.ts";
import { atomicWrite, errorCode, listDir, readJsonFile, renameWithRetry } from "./storage.ts";
import type { VideoTrashEntry } from "./types.ts";

const VIDEO_FILE = /^v(\d{4,})\.mp4$/;

export type VideoStorage = ReturnType<typeof createVideoStorage>;

export function createVideoStorage(paths: AdminPaths, knownProjects: readonly string[]) {
  /** File paths come from validated records only (isSafeVideoFile: a plain name, no folders). */
  function safeName(file: string): string {
    if (!isSafeVideoFile(file)) throw new Error(`Refusing unsafe video file name ${JSON.stringify(file)}`);
    return file;
  }
  const mediaFile = (file: string) => path.join(paths.mediaDir, safeName(file));
  const trashFile = (file: string) => path.join(paths.trashDir, safeName(file));

  /** videos.json; a missing file means "no videos yet". Posters must be existing photos. */
  async function readVideos(photoIds: Iterable<number>): Promise<VideoRecord[]> {
    const raw = (await readJsonFile(paths.videosJson)) ?? [];
    const result = validateVideoRecords(raw, { knownProjects, photoIds });
    if (!result.ok) {
      throw new HttpError(
        500,
        "invalid_data",
        `src/data/videos.json has problems:\n- ${result.problems.join("\n- ")}`,
      );
    }
    return result.records;
  }

  /** Grouped by project (canonical order), so undoing a change restores identical bytes. */
  const writeVideos = (list: readonly VideoRecord[]) =>
    atomicWrite(paths.videosJson, formatVideosJson(groupByProject(list, knownProjects)));

  async function readVideoTrash(): Promise<VideoTrashEntry[]> {
    const raw = await readJsonFile(paths.videoTrashManifest);
    return Array.isArray(raw) ? (raw as VideoTrashEntry[]) : [];
  }

  async function writeVideoTrash(entries: readonly VideoTrashEntry[]): Promise<void> {
    await fs.mkdir(paths.trashDir, { recursive: true });
    await atomicWrite(paths.videoTrashManifest, `${JSON.stringify(entries, null, 2)}\n`);
  }

  async function moveToTrash(file: string): Promise<void> {
    await fs.mkdir(paths.trashDir, { recursive: true });
    await renameWithRetry(mediaFile(file), trashFile(file));
  }

  /** Tolerates a file that never left public/media (an interrupted delete). */
  async function moveFromTrash(file: string): Promise<void> {
    try {
      await renameWithRetry(trashFile(file), mediaFile(file));
    } catch (err) {
      const stillThere = await fs.access(mediaFile(file)).then(
        () => true,
        () => false,
      );
      if (errorCode(err) !== "ENOENT" || !stillThere) throw err;
    }
  }

  /** Put a processed upload in public/media as v<id>.mp4. Never overwrites an existing file. */
  async function publishVideo(processedFile: string, id: number): Promise<string> {
    const file = videoFileForId(id);
    await fs.mkdir(paths.mediaDir, { recursive: true });
    const exists = await fs.access(mediaFile(file)).then(
      () => true,
      () => false,
    );
    if (exists) throw new Error(`public/media/${file} already exists`);
    await renameWithRetry(processedFile, mediaFile(file));
    return file;
  }

  /** Ids of every vNNNN.mp4 in public/media and the trash (so ids are never reused). */
  async function idsOnDisk(): Promise<number[]> {
    const names = (await Promise.all([paths.mediaDir, paths.trashDir].map(listDir))).flat();
    return names.flatMap((name) => {
      const match = VIDEO_FILE.exec(name);
      return match ? [Number(match[1])] : [];
    });
  }

  /** Where a video's bytes are (gallery or trash), for the admin's preview player. */
  const fileFor = (record: VideoRecord, inTrash: boolean) =>
    inTrash ? trashFile(record.file) : mediaFile(record.file);

  return {
    readVideos,
    writeVideos,
    readVideoTrash,
    writeVideoTrash,
    moveToTrash,
    moveFromTrash,
    publishVideo,
    idsOnDisk,
    fileFor,
  };
}
