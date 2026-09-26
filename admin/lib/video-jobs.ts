/**
 * Background video processing. An upload is saved to a temp file, then becomes a job the UI polls.
 * Jobs run one at a time (ffmpeg already uses every core); ffmpeg is a child process, so the admin
 * keeps answering other requests while a video converts. Finished jobs are forgotten after an hour.
 */
import { randomBytes } from "node:crypto";
import type { VideoJob } from "./types.ts";

const KEEP_FINISHED_MS = 60 * 60 * 1000;
export const JOB_ID = /^[A-Za-z0-9_-]{16}$/;

export type JobUpdate = (
  patch: Partial<Pick<VideoJob, "state" | "stage" | "progress" | "message" | "video">>,
) => void;
export type JobTask = (update: JobUpdate) => Promise<void>;

export function createJobRunner() {
  const jobs = new Map<string, VideoJob>();
  const finishedAt = new Map<string, number>();
  let queue: Promise<unknown> = Promise.resolve();

  function forgetOldJobs() {
    const now = Date.now();
    for (const [id, at] of finishedAt) {
      if (now - at <= KEEP_FINISHED_MS) continue;
      jobs.delete(id);
      finishedAt.delete(id);
    }
  }

  /** Queue `task`; returns the job right away (state "queued"). */
  function start(info: Pick<VideoJob, "fileName" | "project">, task: JobTask): VideoJob {
    forgetOldJobs();
    const job: VideoJob = {
      id: randomBytes(12).toString("base64url"),
      state: "queued",
      stage: "Waiting",
      progress: 0,
      ...info,
    };
    jobs.set(job.id, job);
    const update: JobUpdate = (patch) => Object.assign(job, patch);
    queue = queue.then(async () => {
      update({ state: "processing", stage: "Starting" });
      try {
        await task(update);
        update({ state: "done", stage: "Done", progress: 1 });
      } catch (err) {
        update({
          state: "error",
          stage: "Failed",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        finishedAt.set(job.id, Date.now());
      }
    });
    return { ...job };
  }

  /** A copy of the job's current state, or undefined. */
  function get(id: string): VideoJob | undefined {
    const job = jobs.get(id);
    return job && { ...job };
  }

  return { start, get };
}

export type JobRunner = ReturnType<typeof createJobRunner>;
