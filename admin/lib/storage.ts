/**
 * All admin disk I/O: photos.json, photo files and the trash. Writes are atomic (temp file in the
 * same folder + rename) so Astro's dev server or a crash never sees a half-written file, and all
 * changes run one at a time through `withLock`.
 *
 * Step order is chosen so an interruption never leaves photos.json pointing at a missing file:
 * delete = update json, then move the file; restore/upload = put the file in place, then update json.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  formatPhotosJson,
  groupByProject,
  photoFileName,
  validatePhotoRecords,
} from "../../src/lib/gallery/records.ts";
import type { AdminPaths } from "./config.ts";
import { createLock, type Lock } from "./lock.ts";
import { HttpError } from "./http.ts";
import type { PhotoRecord, TrashEntry } from "./types.ts";

const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);
export const errorCode = (err: unknown) => (err as NodeJS.ErrnoException | undefined)?.code;

/** Windows briefly locks files that a watcher or antivirus has open; retry a few times. */
export async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      if (!RETRYABLE.has(errorCode(err) ?? "") || attempt >= 5) throw err;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

export async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  await fs.writeFile(temp, data);
  try {
    await renameWithRetry(temp, file);
  } catch (err) {
    await fs.rm(temp, { force: true });
    throw err;
  }
}

export async function readJsonFile(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    if (errorCode(err) === "ENOENT") return undefined;
    throw err;
  }
}

const PHOTO_FILE = /^p(\d{4,})\.jpg$/;

/** Read a folder's names; a missing folder is just empty. */
export const listDir = (dir: string) =>
  fs.readdir(dir).catch((err: unknown) => {
    if (errorCode(err) === "ENOENT") return [] as string[];
    throw err;
  });

export type Storage = ReturnType<typeof createStorage>;

/**
 * @param withLock shared with the video storage so photo and video changes never interleave
 */
export function createStorage(
  paths: AdminPaths,
  knownProjects: readonly string[],
  withLock: Lock = createLock(),
) {
  async function readPhotos(): Promise<PhotoRecord[]> {
    const raw = await readJsonFile(paths.photosJson);
    const result = validatePhotoRecords(raw ?? null, knownProjects);
    if (!result.ok) {
      throw new HttpError(
        500,
        "invalid_data",
        `src/data/photos.json has problems:\n- ${result.problems.join("\n- ")}`,
      );
    }
    return result.records;
  }

  /** Always written grouped by project (canonical order), so undoing a change restores identical bytes. */
  const writePhotos = (list: readonly PhotoRecord[]) =>
    atomicWrite(paths.photosJson, formatPhotosJson(groupByProject(list, knownProjects)));

  async function readTrash(): Promise<TrashEntry[]> {
    const raw = await readJsonFile(paths.trashManifest);
    return Array.isArray(raw) ? (raw as TrashEntry[]) : [];
  }

  async function writeTrash(entries: readonly TrashEntry[]): Promise<void> {
    await fs.mkdir(paths.trashDir, { recursive: true });
    await atomicWrite(paths.trashManifest, `${JSON.stringify(entries, null, 2)}\n`);
  }

  const galleryFile = (id: number) => path.join(paths.photosDir, photoFileName(id));
  const trashFile = (id: number) => path.join(paths.trashDir, photoFileName(id));

  async function moveToTrash(id: number): Promise<void> {
    await fs.mkdir(paths.trashDir, { recursive: true });
    await renameWithRetry(galleryFile(id), trashFile(id));
  }

  /** Tolerates a file that never left the gallery folder (an interrupted delete). */
  async function moveFromTrash(id: number): Promise<void> {
    try {
      await renameWithRetry(trashFile(id), galleryFile(id));
    } catch (err) {
      const stillInGallery = await fs.access(galleryFile(id)).then(
        () => true,
        () => false,
      );
      if (errorCode(err) !== "ENOENT" || !stillInGallery) throw err;
    }
  }

  async function writeNewPhoto(id: number, data: Uint8Array): Promise<void> {
    await fs.mkdir(paths.photosDir, { recursive: true });
    await atomicWrite(galleryFile(id), data);
  }

  /** Ids of every pNNNN.jpg in the gallery and trash folders (so ids are never reused). */
  async function idsOnDisk(): Promise<number[]> {
    const lists = await Promise.all([paths.photosDir, paths.trashDir].map(listDir));
    return lists.flat().flatMap((name) => {
      const match = PHOTO_FILE.exec(name);
      return match ? [Number(match[1])] : [];
    });
  }

  return {
    withLock,
    readPhotos,
    writePhotos,
    readTrash,
    writeTrash,
    moveToTrash,
    moveFromTrash,
    writeNewPhoto,
    idsOnDisk,
    galleryFile,
    trashFile,
  };
}
