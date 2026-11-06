import { describe, expect, it } from "vitest";
import {
  applyCspHashes,
  isExecutableInlineScript,
  MAX_HEADERS_LINE_LENGTH,
  parseAttributes,
  scanHtml,
  scriptHash,
  withScriptHashes,
} from "../../scripts/csp-hashes.mjs";

const HEADERS = [
  "# comment",
  "/*",
  "  X-Frame-Options: DENY",
  "  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; object-src 'none'",
  "",
  "/_astro/*",
  "  Cache-Control: public, max-age=31536000, immutable",
  "",
].join("\n");

const scriptSrcOf = (headers: string) => /script-src [^;\n]*/.exec(headers)?.[0] ?? "";

describe("scriptHash", () => {
  it("matches the CSP spec's example hash", () => {
    expect(scriptHash("alert('Hello, world.');")).toBe(
      "'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='",
    );
  });

  it("hashes text the way the browser sees it (CRLF and CR become LF)", () => {
    expect(scriptHash("a\r\nb\rc")).toBe(scriptHash("a\nb\nc"));
    expect(scriptHash("a\nb")).not.toBe(scriptHash("a\n b"));
  });
});

describe("isExecutableInlineScript", () => {
  const runs = (attrs: string) => isExecutableInlineScript(parseAttributes(attrs));

  it.each([
    [""],
    [' type=""'],
    [' type="module"'],
    [' type="text/javascript"'],
    [" type=TEXT/JavaScript"],
    [' type="importmap"'],
    [' language="javascript"'],
  ])("runs <script%s>", (attrs) => expect(runs(attrs)).toBe(true));

  it.each([
    [' type="application/ld+json"'],
    [' type="application/json"'],
    [' type="text/template"'],
    [' type="text/javascript; charset=utf-8"'],
    [' src="/_astro/a.js"'],
    [' type="module" src="/_astro/a.js"'],
    [' language="vbscript"'],
  ])("doesn't hash <script%s>", (attrs) => expect(runs(attrs)).toBe(false));
});

describe("scanHtml", () => {
  it("finds inline classic and module scripts, and skips data blocks and external scripts", () => {
    const html =
      `<!doctype html><html><head><script>one()</script><script type="application/ld+json">{"@type":"X"}</script>` +
      `<script type="module" src="/_astro/page.js"></script></head><body>` +
      `<script type="module">two()</script><SCRIPT TYPE="text/javascript">three()</SCRIPT ></body></html>`;
    expect(scanHtml(html)).toEqual({ scripts: ["one()", "two()", "three()"], handlers: [] });
  });

  it("ignores script tags that are only text: in comments, textareas and titles", () => {
    const html =
      `<!-- <script>commented()</script> --><title>a <script>x()</script> title</title>` +
      `<textarea><script>typed()</script></textarea><script>real()</script>`;
    expect(scanHtml(html).scripts).toEqual(["real()"]);
  });

  it("keeps script text byte for byte, including a '>' in an attribute and an empty script", () => {
    const html = `<script data-note="a > b">\n  if (a > b) run();\n</script><script></script>`;
    expect(scanHtml(html).scripts).toEqual(["\n  if (a > b) run();\n", ""]);
  });

  it("reports inline event handlers, but not handler-like text in scripts or attribute values", () => {
    const html =
      `<button type="button" onclick="go()">Go</button><img src="x.jpg" ONLOAD="y()" alt="onclick=nope">` +
      `<script>el.setAttribute("onclick", "x")</script><a title='onmouseover="z"' href="/">a</a>`;
    expect(scanHtml(html).handlers).toEqual(["<button onclick>", "<img onload>"]);
  });
});

describe("withScriptHashes", () => {
  const hashes = [scriptHash("a()"), scriptHash("b()")];

  it("appends the hashes to script-src and leaves every other line and directive alone", () => {
    const out = withScriptHashes(HEADERS, hashes);
    expect(scriptSrcOf(out)).toBe(
      `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com ${hashes.join(" ")}`,
    );
    expect(out).toContain("default-src 'self'; script-src");
    expect(out).toContain("; object-src 'none'");
    expect(out.replace(/script-src [^;\n]*/, "")).toBe(HEADERS.replace(/script-src [^;\n]*/, ""));
  });

  it("replaces hashes from an earlier run instead of piling them up", () => {
    const once = withScriptHashes(HEADERS, hashes);
    const again = withScriptHashes(once, [hashes[0] ?? ""]);
    expect(scriptSrcOf(again)).toBe(
      `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com ${hashes[0]}`,
    );
    expect(withScriptHashes(once, hashes)).toBe(once);
  });

  it("drops 'unsafe-inline' when there is no inline script to hash (it would otherwise apply)", () => {
    expect(scriptSrcOf(withScriptHashes(HEADERS, []))).toBe(
      "script-src 'self' https://challenges.cloudflare.com",
    );
  });

  it("fails loudly without a script-src to rewrite", () => {
    expect(() => withScriptHashes("/*\n  Content-Security-Policy: default-src 'self'\n", hashes)).toThrow(
      /no Content-Security-Policy with a script-src/,
    );
    expect(() => withScriptHashes("/*\n  X-Frame-Options: DENY\n", hashes)).toThrow(/script-src/);
  });

  it("fails before a line passes Cloudflare's 2,000-character limit", () => {
    const many = Array.from({ length: 40 }, (_, i) => scriptHash(`s${i}()`));
    expect(() => withScriptHashes(HEADERS, many)).toThrow(new RegExp(`over ${MAX_HEADERS_LINE_LENGTH}`));
  });
});

describe("applyCspHashes", () => {
  it("dedupes and sorts hashes across pages and collects handler warnings per file", () => {
    const pages = [
      { file: "index.html", html: "<script>shared()</script><script>home()</script>" },
      { file: "gallery.html", html: `<script>shared()</script><div onclick="x()"></div>` },
    ];
    const result = applyCspHashes(pages, HEADERS);
    expect(result.hashes).toEqual([scriptHash("shared()"), scriptHash("home()")].sort());
    expect(
      scriptSrcOf(result.headersText)
        .split(" ")
        .filter((s) => s.startsWith("'sha256-")),
    ).toEqual(result.hashes);
    expect(result.warnings).toEqual(["gallery.html: <div onclick>"]);
  });
});
