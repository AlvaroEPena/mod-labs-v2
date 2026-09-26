/**
 * Video operations. Like the photo handlers, each validates its input, runs under the shared
 * storage lock, and returns the fresh AdminState. Uploads are different: the body streams to a
 * temp file, the request returns a job at once (202), and processing (ffmpeg) runs in the
 * background, taking the lock only for the final, quick publish step.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { processVideo, UnsupportedVideoError } from "../scripts/lib/process-video.mjs";
import type { VideoRecord } from "../src/lib/gallery/video-records.ts";
import {
  ACCEPTED_VIDEO_EXTENSIONS,
  ACCEPTED_VIDEO_TYPES,
  MAX_VIDEO_UPLOAD_BYTES,
  type AdminPaths,
} from "./lib/config.ts";
import { HttpError, streamBodyToFile } from "./lib/http.ts";
import { addItem, arrangeProjects, moveItems, nextId, removeItems, restoreItems } from "./lib/list-ops.ts";
import { parseVideoUploadQuery } from "./lib/parse.ts";
import type { Storage } from "./lib/storage.ts";
import type { JobRunner } from "./lib/video-jobs.ts";
import { updateVideo } from "./lib/video-ops.ts";
import type { VideoStorage } from "./lib/video-storage.ts";
import type {
  AdminState,
  ArrangeBody,
  IdsBody,
  MoveBody,
  VideoJob,
  VideoTrashEntry,
  VideoUpdateBody,
} from "./lib/types.ts";

type Deps = {
  storage: Storage;
  videoStorage: VideoStorage;
  paths: AdminPaths;
  jobs: JobRunner;
  getState: () => Promise<AdminState>;
  logError?: (err: unknown) => void;
};

export function createVideoHandlers({ storage, videoStorage, paths, jobs, getState, logError }: Deps) {
  /** Current photos + videos (videos are validated against the photo ids). */
  async function readAll() {
    const photos = await storage.readPhotos();
    const videos = await videoStorage.readVideos(photos.map((p) => p.id));
    return { photos, videos };
  }

  /** Run a videos.json change under the lock, then report the new state. */
  const change = async (
    task: (videos: VideoRecord[], photos: Awaited<ReturnType<typeof readAll>>["photos"]) => Promise<void>,
  ) => {
    await storage.withLock(async () => {
      const { photos, videos } = await readAll();
      await task(videos, photos);
    });
    return getState();
  };

  const move = ({ ids, project, beforeId }: MoveBody) =>
    change((videos) => videoStorage.writeVideos(moveItems(videos, ids, project, beforeId)));

  const arrange = ({ layout }: ArrangeBody) =>
    change((videos) => videoStorage.writeVideos(arrangeProjects(videos, layout)));

  const update = ({ id, title, posterId }: VideoUpdateBody) =>
    change((videos, photos) => {
      const projectPhotoIds = (project: string) =>
        photos.filter((p) => p.project === project).map((p) => p.id);
      return videoStorage.writeVideos(updateVideo(videos, id, { title, posterId }, projectPhotoIds));
    });

  /** Delete to the trash: videos.json first, then files, then the trash list (always). */
  const remove = ({ ids }: IdsBody) =>
    change(async (videos) => {
      const { list, removals } = removeItems(videos, ids);
      await videoStorage.writeVideos(list);
      const deletedAt = new Date().toISOString();
      const entries: VideoTrashEntry[] = removals.map(({ record, placement }) => ({
        record,
        deletedAt,
        ...placement,
      }));
      try {
        await Promise.all(removals.map(({ record }) => videoStorage.moveToTrash(record.file)));
      } finally {
        const trash = await videoStorage.readVideoTrash();
        await videoStorage.writeVideoTrash([...trash.filter((t) => !ids.includes(t.record.id)), ...entries]);
      }
    });

  /** Restore from the trash, each back where it was. Files first, then videos.json. */
  const restore = ({ ids }: IdsBody) =>
    change(async (videos, photos) => {
      const trash = await videoStorage.readVideoTrash();
      const entries = trash.filter((t) => ids.includes(t.record.id));
      if (entries.length !== ids.length) {
        throw new HttpError(
          404,
          "not_found",
          "Some of those videos aren't in the trash any more. Reload the page.",
        );
      }
      const photoIds = new Set(photos.map((p) => p.id));
      const removals = entries.map(({ record, afterId, index }) => {
        // Its poster photo may have been deleted meanwhile: fall back to "auto".
        const { posterId, ...rest } = record;
        const restored = posterId !== undefined && photoIds.has(posterId) ? record : rest;
        return { record: restored, placement: { afterId, index } };
      });
      const list = restoreItems(videos, removals);
      await Promise.all(entries.map(({ record }) => videoStorage.moveFromTrash(record.file)));
      await videoStorage.writeVideos(list);
      await videoStorage.writeVideoTrash(trash.filter((t) => !ids.includes(t.record.id)));
    });

  /* ---------- upload ---------- */

  /** Accept the upload (streamed to disk, size-limited) and queue processing. Returns the job. */
  async function upload(request: Request, url: URL): Promise<VideoJob> {
    const { project, title, fileName } = parseVideoUploadQuery(url);
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const extension = path.extname(fileName).toLowerCase();
    const isVideoType = ACCEPTED_VIDEO_TYPES.includes(type);
    const isGenericType = type === "" || type === "application/octet-stream";
    if (!isVideoType && !(isGenericType && ACCEPTED_VIDEO_EXTENSIONS.includes(extension))) {
      throw new HttpError(415, "unsupported", `"${fileName}" isn't a video we accept. Use MP4, MOV or WebM.`);
    }

    await fs.mkdir(paths.uploadDir, { recursive: true });
    const token = randomBytes(8).toString("hex");
    const inputFile = path.join(paths.uploadDir, `${token}.upload`);
    const outputFile = path.join(paths.uploadDir, `${token}.mp4`);
    const bytes = await streamBodyToFile(request, inputFile, MAX_VIDEO_UPLOAD_BYTES);
    if (bytes === 0) {
      await fs.rm(inputFile, { force: true });
      throw new HttpError(400, "invalid", "Choose a video to upload.");
    }

    return jobs.start({ fileName, project }, async (report) => {
      try {
        await processVideo(inputFile, outputFile, {
          onProgress: (progress, stage) => report({ stage, progress }),
        });
        report({ stage: "Saving", progress: 1 });
        let added: VideoRecord | undefined;
        await storage.withLock(async () => {
          const { videos } = await readAll();
          const trash = await videoStorage.readVideoTrash();
          const id = nextId([
            ...videos.map((v) => v.id),
            ...trash.map((t) => t.record.id),
            ...(await videoStorage.idsOnDisk()),
          ]);
          const file = await videoStorage.publishVideo(outputFile, id);
          added = { id, file, project, title };
          await videoStorage.writeVideos(addItem(videos, added));
        });
        const state = await getState();
        report({ video: state.videos.find((v) => v.id === added?.id) });
      } catch (err) {
        if (err instanceof UnsupportedVideoError)
          throw new Error(`"${fileName}": ${err.message}`, { cause: err });
        logError?.(err);
        throw new Error(`"${fileName}" couldn't be processed. Check the terminal for details.`, {
          cause: err,
        });
      } finally {
        await Promise.all([fs.rm(inputFile, { force: true }), fs.rm(outputFile, { force: true })]);
      }
    });
  }

  function job(id: string): VideoJob {
    const found = jobs.get(id);
    if (!found)
      throw new HttpError(
        404,
        "not_found",
        "That upload isn't known (the admin may have restarted). Try again.",
      );
    return found;
  }

  /** Path of a gallery or trashed video's file, for the preview player. Chosen by id, never by the request. */
  async function previewFile(id: number): Promise<string> {
    const { videos } = await readAll();
    const live = videos.find((v) => v.id === id);
    if (live) return videoStorage.fileFor(live, false);
    const trashed = (await videoStorage.readVideoTrash()).find((t) => t.record.id === id);
    if (trashed) return videoStorage.fileFor(trashed.record, true);
    throw new HttpError(404, "not_found", "No such video.");
  }

  return { move, arrange, update, remove, restore, upload, job, previewFile };
}
