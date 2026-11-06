// Owner recovery for review moderation, e.g. when an emailed Approve link has expired (they last 30 days):
//
//   node scripts/reviews-admin.mjs approve <id> [--local]
//   node scripts/reviews-admin.mjs delete <id> [--local]
//
// <id> is the `id=` number in the moderation email's links, or a row from `npm run reviews:pending`.
// Runs `wrangler d1 execute mod-labs-reviews --remote --command …` (the production database), or `--local`
// for the local wrangler dev database. approve publishes a pending review; delete removes a review in any state.
//
// Only the validated id (a positive whole number) and the current time are ever written into the SQL: the D1
// CLI takes no bound parameters, so nothing typed by a person reaches it unchecked.
//
// The site caches the published list and this script can't purge that cache (only the Worker's own moderation
// flow does), so the change shows on the site within the cache TTL: up to about 70 s, EDGE_TTL_SECONDS (60 s)
// + MEMORY_TTL_MS (10 s) in worker/reviews/cache.ts.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DATABASE = "mod-labs-reviews";
const USAGE = "Usage: node scripts/reviews-admin.mjs approve|delete <id> [--local]";
/** Same shape the moderation links accept (worker/reviews/signing.ts). */
const REVIEW_ID = /^[1-9]\d{0,14}$/;
const TARGET_FLAGS = new Set(["--local", "--remote"]);

/**
 * @typedef {{ action: "approve" | "delete", id: number, target: "local" | "remote" }} AdminCommand
 */

/**
 * Command-line arguments (after the script path) → the command, or an error for the usage message.
 * @param {string[]} argv
 * @returns {AdminCommand | { error: string }}
 */
export function parseArgs(argv) {
  const flags = argv.filter((arg) => arg.startsWith("-"));
  const [action, id, ...extra] = argv.filter((arg) => !arg.startsWith("-"));
  const unknownFlag = flags.find((flag) => !TARGET_FLAGS.has(flag));
  if (unknownFlag) return { error: `Unknown option ${unknownFlag}.` };
  if (flags.includes("--local") && flags.includes("--remote"))
    return { error: "Use --local or --remote, not both." };
  if (action !== "approve" && action !== "delete")
    return { error: 'The first argument must be "approve" or "delete".' };
  if (id === undefined || !REVIEW_ID.test(id))
    return { error: "The review id must be a positive whole number, like 12." };
  if (extra.length > 0) return { error: `Unexpected argument ${extra[0]}.` };
  return { action, id: Number(id), target: flags.includes("--local") ? "local" : "remote" };
}

/**
 * The one SQL statement for a command. RETURNING tells whether a row changed (local D1 reports no counts).
 * @param {Pick<AdminCommand, "action" | "id">} command
 * @param {number} nowMs
 */
export function buildSql({ action, id }, nowMs) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`Refusing to build SQL for id ${id}.`);
  if (!Number.isSafeInteger(nowMs))
    throw new Error("Refusing to build SQL without a whole-millisecond time.");
  if (action === "approve") {
    return `UPDATE reviews SET status = 'approved', approved_at = ${nowMs} WHERE id = ${id} AND status = 'pending' RETURNING id`;
  }
  return `DELETE FROM reviews WHERE id = ${id} RETURNING id`;
}

/**
 * @param {AdminCommand} command
 * @param {string} sql
 */
export const wranglerArgs = (command, sql) => [
  "d1",
  "execute",
  DATABASE,
  `--${command.target}`,
  "--json",
  "--command",
  sql,
];

/**
 * What to tell the owner, from wrangler's --json output (an array of statement results).
 * @param {AdminCommand} command
 * @param {unknown} output
 * @returns {{ ok: boolean, message: string }}
 */
export function describeOutcome(command, output) {
  const first = Array.isArray(output) ? output[0] : undefined;
  const rows = first && typeof first === "object" && Array.isArray(first.results) ? first.results : null;
  if (!rows) return { ok: false, message: "Couldn't read wrangler's answer. Check the database by hand." };
  const where = command.target === "local" ? "the local database" : "production";
  if (rows.length === 0) {
    return {
      ok: false,
      message:
        command.action === "approve"
          ? `No pending review ${command.id} in ${where} (already published, deleted, or never there). Nothing changed.`
          : `No review ${command.id} in ${where} (already deleted, or never there). Nothing changed.`,
    };
  }
  const done = command.action === "approve" ? "approved and published" : "deleted";
  return {
    ok: true,
    message: `Review ${command.id} ${done} in ${where}. The site's cached list catches up within about 70 seconds.`,
  };
}

function main() {
  const command = parseArgs(process.argv.slice(2));
  if ("error" in command) {
    console.error(`${command.error}\n${USAGE}`);
    process.exit(2);
  }
  const root = path.resolve(import.meta.dirname, "..");
  // Run wrangler's JS entry with this Node, no shell: nothing is re-parsed, and Windows needs no npx.cmd.
  const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
  if (!fs.existsSync(wrangler)) throw new Error("wrangler isn't installed. Run npm install first.");

  const sql = buildSql(command, Date.now());
  console.log(`${command.action} review ${command.id} (${command.target}): ${sql}`);
  const run = spawnSync(process.execPath, [wrangler, ...wranglerArgs(command, sql)], {
    cwd: root,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  });
  if (run.status !== 0) throw new Error(`wrangler exited with ${run.status ?? run.signal}.`);

  let output;
  try {
    output = JSON.parse(run.stdout);
  } catch {
    output = undefined;
    console.log(run.stdout);
  }
  const outcome = describeOutcome(command, output);
  (outcome.ok ? console.log : console.error)(`${outcome.ok ? "✓" : "✖"} ${outcome.message}`);
  if (!outcome.ok) process.exitCode = 1;
}

const isCli =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) {
  try {
    main();
  } catch (err) {
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
