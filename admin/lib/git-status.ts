/** How many gallery files differ from the last git commit (the "unpublished changes" banner). */
import { execFile } from "node:child_process";
import type { PendingChanges } from "./types.ts";

export const GALLERY_PATHS = ["src/data/photos.json", "src/assets/gallery"];

/** Parse `git status --porcelain` output: one line per changed file. */
export const countChangedFiles = (porcelain: string) =>
  porcelain.split("\n").filter((line) => line.trim() !== "").length;

export function gitPendingChanges(root: string): Promise<PendingChanges> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["status", "--porcelain", "--untracked-files=all", "--", ...GALLERY_PATHS],
      { cwd: root, timeout: 5000, windowsHide: true },
      (err, stdout) => {
        if (err) resolve({ count: null, reason: "Couldn't ask git for changes." });
        else resolve({ count: countChangedFiles(stdout) });
      },
    );
  });
}
