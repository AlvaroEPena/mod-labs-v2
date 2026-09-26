/** Generate small test videos with ffmpeg (from the ffmpeg-static devDependency). */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);

/** Metadata a phone would write: GPS location (both QuickTime forms), a date and a title. */
export const PHONE_METADATA = [
  "-metadata",
  "location=+47.6062-122.3321/",
  "-metadata",
  "com.apple.quicktime.location.ISO6709=+47.6062-122.3321+000.000/",
  "-metadata",
  "creation_time=2025-06-01T10:00:00Z",
  "-metadata",
  "title=Private title",
  "-movflags",
  "+use_metadata_tags",
];

type ClipOptions = {
  seconds?: number;
  size?: string;
  /** a phone held sideways: stored landscape with a rotation flag */
  rotation?: number;
  codec?: "h264" | "vp9";
  withPhoneMetadata?: boolean;
};

/** Write a test clip (with a tone) to `file`. */
export async function makeClip(
  file: string,
  { seconds = 2, size = "320x240", rotation, codec = "h264", withPhoneMetadata = true }: ClipOptions = {},
) {
  const binary = ffmpegPath as unknown as string;
  const codecArgs =
    codec === "vp9"
      ? ["-c:v", "libvpx-vp9", "-b:v", "300k", "-c:a", "libopus"]
      : ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"];
  const encoded = rotation === undefined ? file : `${file}.plain${codec === "vp9" ? ".webm" : ".mov"}`;
  await run(binary, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${size}:rate=15`,
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440",
    "-t",
    String(seconds),
    ...codecArgs,
    ...(withPhoneMetadata ? PHONE_METADATA : []),
    encoded,
  ]);
  if (rotation === undefined) return;
  // Phones store the picture sideways plus a rotation flag: add the flag without re-encoding.
  await run(binary, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-display_rotation:v:0",
    String(rotation),
    "-i",
    encoded,
    "-c",
    "copy",
    ...(withPhoneMetadata ? PHONE_METADATA : []),
    file,
  ]);
}
