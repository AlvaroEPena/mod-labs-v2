// Gallery video processing (used by the photo admin's video upload). One place decides what a
// published video looks like:
// - always an MP4 remux/transcode with ALL metadata removed (-map_metadata -1, no chapters, bitexact:
//   no GPS/©xyz/com.apple.quicktime.location, no dates, no encoder tags) and +faststart;
// - stream copy when the input is already H.264 (yuv420p) + AAC and fits in 24 MiB;
// - otherwise H.264/AAC, ≤1080px long edge, stepping quality down until it fits in 24 MiB
//   (Cloudflare rejects static files over 25 MiB);
// - then the output is VERIFIED (box by box) and rejected if any metadata survived.
// Uses the ffmpeg binary from `ffmpeg-static`, an optionalDependency: Cloudflare's deploy build
// doesn't need it, so a failed binary download there must not break the site build. It's loaded
// lazily, so the admin still starts (photos keep working) if it's missing; video uploads then fail
// with a clear message. ffmpeg runs as a child process, so processing never blocks the admin server.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";

/** @type {Promise<string>} */
let ffmpegBinary;
/** Resolve the ffmpeg binary once, or explain how to install it. */
function loadFfmpeg() {
  ffmpegBinary ??= import("ffmpeg-static").then(
    (mod) => {
      const binary = /** @type {string | null} */ (/** @type {unknown} */ (mod.default));
      if (!binary) throw new Error("ffmpeg-static has no binary for this platform.");
      return binary;
    },
    () => {
      throw new Error("Video tools aren't installed. Run `npm install` in the site folder, then restart the admin.");
    },
  );
  return ffmpegBinary;
}

export const MAX_INPUT_BYTES = 500 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 180;
export const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;
export const MAX_EDGE_PX = 1080;
const AUDIO_KBPS = 128;
/** Leave room for the MP4 container and bitrate spikes when budgeting. */
const BUDGET_SAFETY = 0.9;
/** Each attempt is smaller than the last; the first that fits wins. */
const TRANSCODE_LADDER = [
  { crf: 26, maxEdge: MAX_EDGE_PX, audioKbps: AUDIO_KBPS },
  { crf: 28, maxEdge: MAX_EDGE_PX, audioKbps: AUDIO_KBPS },
  { crf: 30, maxEdge: 720, audioKbps: 96 },
  { crf: 32, maxEdge: 540, audioKbps: 64 },
];
const TIMEOUT_MS = 20 * 60 * 1000;

export class UnsupportedVideoError extends Error {
  name = "UnsupportedVideoError";
}

/**
 * Run ffmpeg. Resolves with stderr; rejects on a non-zero exit unless `allowFailure`.
 * @param {string[]} args
 * @param {{ allowFailure?: boolean, onProgressLine?: (line: string) => void }} [options]
 * @returns {Promise<{ code: number | null, stderr: string }>}
 */
async function runFfmpeg(args, { allowFailure = false, onProgressLine } = {}) {
  const binary = await loadFfmpeg();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["-hide_banner", "-nostdin", ...args], { windowsHide: true });
    let stderr = "";
    let stdoutBuffer = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-200_000); // keep the tail; probes are small
    });
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) onProgressLine?.(line.trim());
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 || allowFailure) resolve({ code, stderr });
      else
        reject(new Error(`ffmpeg failed (exit ${code}): ${stderr.split("\n").slice(-4).join(" ").trim()}`));
    });
  });
}

/**
 * @typedef {{
 *   durationSeconds: number,
 *   video: { codec: string, pixFmt: string, width: number, height: number, rotation: number } | null,
 *   audio: { codec: string } | null,
 *   formatTags: string[],
 *   streamTags: [string, string][],
 * }} VideoInfo
 */

/**
 * Read what ffmpeg says about a file (ffmpeg-static ships no ffprobe; `ffmpeg -i` prints the same
 * facts). Only the first video and first audio stream matter.
 * @param {string} file
 * @returns {Promise<VideoInfo>}
 */
export async function probeVideo(file) {
  const { stderr } = await runFfmpeg(["-i", file], { allowFailure: true });
  const inputAt = stderr.indexOf("Input #0");
  if (inputAt === -1)
    throw new UnsupportedVideoError("This file isn't a video we can read. Use an MP4, MOV or WebM file.");
  const text = stderr.slice(inputAt);
  const duration = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  const durationSeconds = duration
    ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
    : NaN;

  const lines = text.split(/\r?\n/);
  const videoLine = lines.find((l) => /Stream #0:\d+.*: Video: /.test(l) && !/attached pic/.test(l));
  const audioLine = lines.find((l) => /Stream #0:\d+.*: Audio: /.test(l));
  const size = videoLine ? /, (\d{2,5})x(\d{2,5})[ ,]/.exec(videoLine) : null;
  const rotation = /displaymatrix: rotation of (-?\d+(?:\.\d+)?) degrees/.exec(text);

  // Metadata keys, split into the container's ("Input" block) and the streams' blocks.
  /** @type {string[]} */
  const formatTags = [];
  /** @type {[string, string][]} */
  const streamTags = [];
  let section = "none";
  for (const line of lines) {
    if (/^Input #0/.test(line)) section = "format";
    else if (/^\s*Stream #0/.test(line)) section = "stream";
    else if (/^\s*Metadata:\s*$/.test(line)) continue;
    else if (/^\s*(Duration|Side data|Chapters?)/.test(line))
      section = section === "format" ? "format-info" : "stream-info";
    else {
      const tag = /^\s{4,}([^:]+?)\s*:\s?(.*)$/.exec(line);
      if (tag && section === "format") formatTags.push(tag[1]);
      if (tag && section === "stream") streamTags.push([tag[1], tag[2].trim()]);
    }
  }

  return {
    durationSeconds,
    video: videoLine
      ? {
          codec: /Video: (\w+)/.exec(videoLine)?.[1] ?? "",
          pixFmt: /Video: \w+[^,]*, (\w+)/.exec(videoLine)?.[1] ?? "",
          width: Number(size?.[1] ?? 0),
          height: Number(size?.[2] ?? 0),
          rotation: rotation ? Number(rotation[1]) : 0,
        }
      : null,
    audio: audioLine ? { codec: /Audio: (\w+)/.exec(audioLine)?.[1] ?? "" } : null,
    formatTags,
    streamTags,
  };
}

/** Output options shared by copy and transcode: drop every kind of metadata, web-friendly MP4. */
const CLEAN_MP4_ARGS = [
  "-map_metadata",
  "-1",
  "-map_metadata:s:v",
  "-1",
  "-map_metadata:s:a",
  "-1",
  "-map_chapters",
  "-1",
  "-dn",
  "-sn",
  "-fflags",
  "+bitexact",
  "-flags:v",
  "+bitexact",
  "-flags:a",
  "+bitexact",
  "-movflags",
  "+faststart",
  "-f",
  "mp4",
];

/**
 * Turn ffmpeg `-progress` lines into a 0–1 fraction.
 * @param {number} durationSeconds
 * @param {((fraction: number) => void) | undefined} onProgress
 */
const progressReader = (durationSeconds, onProgress) => (/** @type {string} */ line) => {
  const match = /^out_time_(?:us|ms)=(\d+)$/.exec(line);
  if (!match || !onProgress || !durationSeconds) return;
  onProgress(Math.min(1, Number(match[1]) / 1e6 / durationSeconds));
};

/**
 * Turn any accepted input into a clean, web-ready MP4 at `outputFile`.
 * @param {string} inputFile
 * @param {string} outputFile
 * @param {{ onProgress?: (fraction: number, stage: string) => void }} [options]
 * @returns {Promise<{ mode: "copy" | "transcode", bytes: number, durationSeconds: number, width: number, height: number }>}
 * @throws {UnsupportedVideoError} for inputs we refuse (with a message for the owner)
 */
export async function processVideo(inputFile, outputFile, { onProgress } = {}) {
  const { size: inputBytes } = await fs.stat(inputFile);
  if (inputBytes > MAX_INPUT_BYTES) {
    throw new UnsupportedVideoError(
      `That video is over ${MAX_INPUT_BYTES / 2 ** 20} MB. Trim or export a shorter clip first.`,
    );
  }
  const info = await probeVideo(inputFile);
  if (!info.video || !info.video.width)
    throw new UnsupportedVideoError("This file has no video we can read. Use an MP4, MOV or WebM file.");
  if (!Number.isFinite(info.durationSeconds) || info.durationSeconds <= 0) {
    throw new UnsupportedVideoError("Couldn't tell how long this video is. Try exporting it again.");
  }
  if (info.durationSeconds > MAX_DURATION_SECONDS + 0.5) {
    const minutes = Math.floor(info.durationSeconds / 60);
    const seconds = Math.round(info.durationSeconds % 60);
    throw new UnsupportedVideoError(
      `That video is ${minutes}:${String(seconds).padStart(2, "0")} long. Videos can be up to 3 minutes; trim it first.`,
    );
  }

  const isWebReady =
    info.video.codec === "h264" &&
    info.video.pixFmt === "yuv420p" &&
    (!info.audio || info.audio.codec === "aac");
  if (isWebReady && inputBytes <= MAX_OUTPUT_BYTES * 1.05) {
    onProgress?.(0, "Copying");
    // Stream copy keeps the phone's rotation flag (display matrix), which browsers honour.
    await runFfmpeg([
      "-y",
      "-i",
      inputFile,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c",
      "copy",
      ...CLEAN_MP4_ARGS,
      outputFile,
    ]);
    const bytes = (await fs.stat(outputFile)).size;
    if (bytes <= MAX_OUTPUT_BYTES) return finish(outputFile, "copy", onProgress);
  }

  for (const [index, step] of TRANSCODE_LADDER.entries()) {
    const stage = index === 0 ? "Converting" : `Converting (smaller, try ${index + 1})`;
    onProgress?.(0, stage);
    const audioKbps = info.audio ? step.audioKbps : 0;
    // Capped CRF: CRF quality, but never above the bitrate that fits the size budget.
    const budgetKbps =
      Math.floor((MAX_OUTPUT_BYTES * 8 * BUDGET_SAFETY) / info.durationSeconds / 1000) - audioKbps;
    const videoKbps = Math.max(150, Math.min(8000, budgetKbps));
    const edge = step.maxEdge;
    // ffmpeg auto-rotates before filters, so this scales the upright picture; even sizes for yuv420p.
    const scale = `scale=w='if(gte(iw,ih),min(${edge},iw),-2)':h='if(gte(iw,ih),-2,min(${edge},ih))',scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`;
    await runFfmpeg(
      [
        "-y",
        "-i",
        inputFile,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        scale,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        String(step.crf),
        "-maxrate",
        `${videoKbps}k`,
        "-bufsize",
        `${videoKbps * 2}k`,
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        ...(info.audio ? ["-c:a", "aac", "-b:a", `${audioKbps}k`, "-ac", "2"] : ["-an"]),
        "-progress",
        "pipe:1",
        "-nostats",
        ...CLEAN_MP4_ARGS,
        outputFile,
      ],
      { onProgressLine: progressReader(info.durationSeconds, onProgress && ((f) => onProgress(f, stage))) },
    );
    if ((await fs.stat(outputFile)).size <= MAX_OUTPUT_BYTES)
      return finish(outputFile, "transcode", onProgress);
  }
  throw new UnsupportedVideoError("Couldn't make this video small enough (24 MB). Try a shorter clip.");
}

/**
 * @param {string} outputFile
 * @param {"copy" | "transcode"} mode
 * @param {((fraction: number, stage: string) => void) | undefined} onProgress
 */
async function finish(outputFile, mode, onProgress) {
  onProgress?.(1, "Checking");
  await neutralizeEmptyUserData(outputFile);
  const check = await verifyCleanVideo(outputFile);
  if (!check.ok)
    throw new Error(
      `The processed video still had metadata, so it was not saved: ${check.problems.join("; ")}`,
    );
  const info = await probeVideo(outputFile);
  const rotated = Math.abs(info.video?.rotation ?? 0) % 180 === 90;
  return {
    mode,
    bytes: (await fs.stat(outputFile)).size,
    durationSeconds: info.durationSeconds,
    width: rotated ? (info.video?.height ?? 0) : (info.video?.width ?? 0),
    height: rotated ? (info.video?.width ?? 0) : (info.video?.height ?? 0),
  };
}

/* ---------- MP4 box inspection ---------- */

/**
 * @typedef {{ type: string, start: number, headerSize: number, size: number, children: Box[] }} Box
 */

const CONTAINERS = new Set([
  "moov",
  "trak",
  "mdia",
  "minf",
  "stbl",
  "dinf",
  "edts",
  "udta",
  "mvex",
  "moof",
  "traf",
]);

/**
 * Parse the box tree (containers only; `meta` is a full box with 4 extra header bytes).
 * @param {Buffer} buf
 * @param {number} [start]
 * @param {number} [end]
 * @returns {Box[]}
 */
export function parseBoxes(buf, start = 0, end = buf.length) {
  /** @type {Box[]} */
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    const type = buf.toString("latin1", offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) size = end - offset;
    if (size < headerSize || offset + size > end)
      throw new Error(`Malformed MP4 box "${type}" at ${offset}.`);
    const box = { type, start: offset, headerSize, size, children: /** @type {Box[]} */ ([]) };
    if (CONTAINERS.has(type)) box.children = parseBoxes(buf, offset + headerSize, offset + size);
    else if (type === "meta") box.children = parseBoxes(buf, offset + headerSize + 4, offset + size);
    else if (type === "ilst") box.children = parseBoxes(buf, offset + headerSize, offset + size);
    boxes.push(box);
    offset += size;
  }
  return boxes;
}

/** @param {Box[]} boxes @returns {Box[]} */
const flatten = (boxes) => boxes.flatMap((b) => [b, ...flatten(b.children)]);

/**
 * ffmpeg's MP4 muxer always writes an EMPTY `udta/meta/ilst` (no items). Retype such a box to
 * `free` (same size, valid anywhere) so the file has no metadata atoms at all. A `udta` with any
 * content is left alone, and verification then rejects the file.
 * @param {string} file
 */
async function neutralizeEmptyUserData(file) {
  const buf = await fs.readFile(file);
  let changed = false;
  for (const box of flatten(parseBoxes(buf))) {
    if (box.type !== "udta") continue;
    const inner = flatten(box.children);
    const isEmpty =
      inner.every((b) => ["meta", "hdlr", "ilst"].includes(b.type)) &&
      inner.filter((b) => b.type === "ilst").every((b) => b.children.length === 0);
    if (!isEmpty) continue;
    buf.write("free", box.start + 4, "latin1");
    changed = true;
  }
  if (changed) await fs.writeFile(file, buf);
}

/** Box types that carry user/location/date metadata. `©...` boxes are QuickTime text metadata. */
const METADATA_BOXES = new Set([
  "udta",
  "meta",
  "ilst",
  "keys",
  "loci",
  "xyz ",
  "uuid",
  "XMP_",
  "cprt",
  "albm",
  "auth",
  "titl",
  "dscp",
  "gnre",
  "perf",
  "yrrc",
  "kywd",
  "rtng",
  "clsf",
]);
const ALLOWED_FORMAT_TAGS = new Set(["major_brand", "minor_version", "compatible_brands"]);
const ALLOWED_STREAM_TAGS = new Set(["handler_name", "vendor_id", "language"]);
/** The H.264 sample entry's compressor-name field (reported as "encoder"): names the codec only. */
const ALLOWED_ENCODER_NAME = /^(Lavc[\d.]* )?libx264$/;
const TIME_BOXES = new Set(["mvhd", "tkhd", "mdhd"]);

/**
 * Prove a file is safe to publish: faststart (moov before mdat), no metadata boxes, zeroed
 * creation/modification times, no location strings, and ffmpeg reports no tags beyond the basics.
 * @param {string} file
 * @returns {Promise<{ ok: boolean, problems: string[] }>}
 */
export async function verifyCleanVideo(file) {
  const problems = [];
  const buf = await fs.readFile(file);
  let top;
  try {
    top = parseBoxes(buf);
  } catch (err) {
    return { ok: false, problems: [String(err)] };
  }
  const moovAt = top.findIndex((b) => b.type === "moov");
  const mdatAt = top.findIndex((b) => b.type === "mdat");
  if (moovAt === -1 || mdatAt === -1) problems.push("not a complete MP4");
  else if (moovAt > mdatAt) problems.push("not faststart (moov after mdat)");
  if (buf.length > MAX_OUTPUT_BYTES) problems.push(`larger than ${MAX_OUTPUT_BYTES / 2 ** 20} MiB`);

  const moov = top[moovAt];
  for (const box of moov ? flatten([moov]) : []) {
    if (METADATA_BOXES.has(box.type) || box.type.charCodeAt(0) === 0xa9)
      problems.push(`metadata box "${box.type}"`);
    if (TIME_BOXES.has(box.type)) {
      const at = box.start + box.headerSize;
      const version = buf[at];
      const created = version === 1 ? buf.readBigUInt64BE(at + 4) : BigInt(buf.readUInt32BE(at + 4));
      const modified = version === 1 ? buf.readBigUInt64BE(at + 12) : BigInt(buf.readUInt32BE(at + 8));
      if (created !== 0n || modified !== 0n) problems.push(`${box.type} keeps a date`);
    }
  }
  if (moov) {
    const header = buf.toString("latin1", moov.start, moov.start + moov.size);
    for (const needle of ["com.apple", "ISO6709", "location", "©xyz"]) {
      if (header.includes(needle)) problems.push(`found "${needle}"`);
    }
  }
  const info = await probeVideo(file);
  const extraFormat = info.formatTags.filter((t) => !ALLOWED_FORMAT_TAGS.has(t));
  const extraStream = info.streamTags.filter(
    ([key, value]) =>
      !ALLOWED_STREAM_TAGS.has(key) && !(key === "encoder" && ALLOWED_ENCODER_NAME.test(value)),
  );
  if (extraFormat.length) problems.push(`container tags: ${extraFormat.join(", ")}`);
  if (extraStream.length) problems.push(`stream tags: ${extraStream.map(([key]) => key).join(", ")}`);
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}
