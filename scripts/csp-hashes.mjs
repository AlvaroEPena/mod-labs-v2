// Postbuild step of `npm run build` (spec §18): a hash-based script-src for the static site.
//
// Scans every dist/**/*.html for inline scripts the browser executes, hashes each one (SHA-256) and writes
// the deduplicated, sorted list into the script-src directive of dist/_headers (astro build copies it there
// from public/_headers). 'unsafe-inline' stays only as the CSP Level 1 fallback: a browser that understands
// hashes ignores 'unsafe-inline' once a hash is present (CSP3 "Does a source list allow all inline behavior").
//
// These headers also reach / and /reviews, which run through the Worker first: the Worker gets the page from
// env.ASSETS.fetch(), and the asset layer applies _headers rules to that response (worker/reviews/publish.ts).
//
// Hashes don't cover inline event-handler attributes (onclick="…"), so those are reported as warnings.
// The build fails when dist/_headers has no script-src to rewrite, or a line grows past Cloudflare's limit.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Cloudflare's per-line limit for _headers (https://developers.cloudflare.com/workers/static-assets/headers/). */
export const MAX_HEADERS_LINE_LENGTH = 2000;

/** JavaScript MIME type essences (WHATWG MIME Sniffing §4.6): a script with one of these types runs. */
const JS_MIME_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);
/** Other inline script types the browser processes, and checks against script-src. */
const NON_MIME_SCRIPT_TYPES = new Set(["module", "importmap", "speculationrules"]);

/** Elements whose content is text, not markup (with scripting on), so a "<script" inside them is not a tag. */
const RAW_TEXT_ELEMENTS = "script|style|textarea|title|xmp|iframe|noembed|noframes|noscript";
/** A start tag's attribute part; quoted values may contain ">". */
const ATTRIBUTES = String.raw`(?:[^>"']|"[^"]*"|'[^']*')*`;
// One pass over the document: comments, raw-text elements with their content, or any other start tag.
// Groups: 1 raw-text tag name, 2 its attributes, 3 its content, 4 other tag name, 5 its attributes.
const TOKEN = new RegExp(
  String.raw`<!--[\s\S]*?(?:-->|$)` +
    String.raw`|<(${RAW_TEXT_ELEMENTS})\b(${ATTRIBUTES})>([\s\S]*?)(?:<\/\1\s*>|$)` +
    String.raw`|<([a-z][^\s/>]*)(${ATTRIBUTES})>`,
  "gi",
);
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const HASH_SOURCE = /^'sha(?:256|384|512)-[A-Za-z0-9+/_=-]+'$/i;

/**
 * Attribute names (lower-cased) → values; the first occurrence wins, as in the HTML parser.
 * @param {string} source the text between the tag name and ">"
 * @returns {Map<string, string>}
 */
export function parseAttributes(source) {
  const attributes = new Map();
  for (const [, name, doubleQuoted, singleQuoted, unquoted] of source.matchAll(ATTRIBUTE)) {
    const key = name.toLowerCase();
    if (!attributes.has(key)) attributes.set(key, doubleQuoted ?? singleQuoted ?? unquoted ?? "");
  }
  return attributes;
}

/**
 * Whether a <script> runs as inline code (HTML "prepare the script element"): no src, and no type, an empty
 * type, a JavaScript MIME type, "module", "importmap" or "speculationrules". Anything else (application/ld+json,
 * text/template, …) is a data block the browser never runs, so it needs no hash.
 * @param {Map<string, string>} attributes
 */
export function isExecutableInlineScript(attributes) {
  if (attributes.has("src")) return false; // external: allowed by host sources, not hashes
  const type = attributes.get("type");
  const language = attributes.get("language");
  if (type === "" || (type === undefined && !language)) return true;
  const typeString = (type ?? `text/${language}`).trim().toLowerCase();
  return JS_MIME_TYPES.has(typeString) || NON_MIME_SCRIPT_TYPES.has(typeString);
}

/**
 * The inline executable scripts' text, and the inline event-handler attributes, of one HTML document.
 * @param {string} html
 * @returns {{ scripts: string[], handlers: string[] }} handlers as `<tag onevent>`
 */
export function scanHtml(html) {
  const scripts = [];
  const handlers = [];
  for (const [, rawTextTag, rawTextAttributes, content, tag, tagAttributes] of html.matchAll(TOKEN)) {
    const name = (rawTextTag ?? tag)?.toLowerCase();
    if (name === undefined) continue; // a comment
    const attributes = parseAttributes(rawTextAttributes ?? tagAttributes ?? "");
    for (const attribute of attributes.keys()) {
      if (/^on[a-z]/.test(attribute)) handlers.push(`<${name} ${attribute}>`);
    }
    if (name === "script" && isExecutableInlineScript(attributes)) scripts.push(content ?? "");
  }
  return { scripts, handlers };
}

/**
 * The CSP hash source for an inline script. The HTML parser turns CRLF/CR into LF before the browser hashes
 * the text, so the same is done here.
 * @param {string} text
 */
export function scriptHash(text) {
  const normalized = text.replace(/\r\n?/g, "\n");
  return `'sha256-${createHash("sha256").update(normalized, "utf8").digest("base64")}'`;
}

/**
 * `_headers` text with `hashes` in every Content-Security-Policy script-src (replacing hashes from an earlier
 * run, keeping every other source and directive). Throws when there's no script-src or a line gets too long.
 * @param {string} headersText
 * @param {string[]} hashes
 */
export function withScriptHashes(headersText, hashes) {
  let rewrittenCount = 0;
  const lines = headersText.split(/\r?\n/).map((line) => {
    const header = /^(\s+Content-Security-Policy\s*:\s*)(.*)$/i.exec(line);
    if (!header) return line;
    let hasScriptSrc = false;
    const directives = header[2]
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name = "", ...sources] = directive.split(/\s+/);
        if (name.toLowerCase() !== "script-src") return directive;
        hasScriptSrc = true;
        const kept = sources.filter((source) => !HASH_SOURCE.test(source));
        // No inline scripts at all: nothing needs 'unsafe-inline', and without a hash next to it browsers
        // would honour it, so drop it.
        const fallback = hashes.length
          ? kept
          : kept.filter((source) => source.toLowerCase() !== "'unsafe-inline'");
        return [name, ...fallback, ...hashes].join(" ");
      });
    if (!hasScriptSrc) return line;
    rewrittenCount += 1;
    return header[1] + directives.join("; ");
  });

  if (rewrittenCount === 0) {
    throw new Error(
      "dist/_headers has no Content-Security-Policy with a script-src directive to add the hashes to.",
    );
  }
  const tooLong = lines.find((line) => line.length > MAX_HEADERS_LINE_LENGTH);
  if (tooLong) {
    throw new Error(
      `A dist/_headers line is ${tooLong.length} characters (${hashes.length} script hashes); Cloudflare ignores lines over ${MAX_HEADERS_LINE_LENGTH}. Move inline scripts into bundled ones.`,
    );
  }
  return lines.join("\n");
}

/**
 * Hashes every page's inline scripts into the headers.
 * @param {{ file: string, html: string }[]} pages
 * @param {string} headersText
 */
export function applyCspHashes(pages, headersText) {
  const hashes = new Set();
  const warnings = [];
  for (const { file, html } of pages) {
    const { scripts, handlers } = scanHtml(html);
    for (const script of scripts) hashes.add(scriptHash(script));
    for (const handler of handlers) warnings.push(`${file}: ${handler}`);
  }
  const sorted = [...hashes].sort();
  return { headersText: withScriptHashes(headersText, sorted), hashes: sorted, warnings };
}

function main() {
  const dist = path.resolve(import.meta.dirname, "..", "dist");
  const headersFile = path.join(dist, "_headers");
  if (!fs.existsSync(headersFile)) throw new Error(`${headersFile} not found. Run astro build first.`);
  const pages = fs
    .readdirSync(dist, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".html"))
    .map((file) => ({ file, html: fs.readFileSync(path.join(dist, file), "utf8") }));
  if (pages.length === 0) throw new Error(`No HTML pages in ${dist}.`);

  const result = applyCspHashes(pages, fs.readFileSync(headersFile, "utf8"));
  for (const warning of result.warnings) {
    console.warn(`⚠ inline event handler (not covered by script hashes, the CSP blocks it): ${warning}`);
  }
  fs.writeFileSync(headersFile, result.headersText);
  console.log(
    `✓ CSP: ${result.hashes.length} inline script hashes from ${pages.length} pages written to dist/_headers`,
  );
}

const isCli =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) {
  try {
    main();
  } catch (err) {
    console.error(`\n✖ csp-hashes: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
