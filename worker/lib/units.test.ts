import { describe, expect, it } from "vitest";
import { buildSubject, renderEmail, toBase64 } from "./email";
import { escapeHtml, safeFilename, singleLine } from "./escape";
import { isCrossSite } from "../handler";
import { MemoryRateLimiter } from "./ratelimit";
import { emailMode, isLocalHostname, isTestTurnstileSecret, type Env } from "./env";
import { checkSiteverify } from "./integrations";
import { byteLimitStream, readFormDataLimited } from "./body";
import { validateFields } from "./validate";
import type { BookInput, QuoteInput } from "../../src/lib/forms/schema";

const book: BookInput = {
  name: "Sam",
  email: "sam@example.com",
  phone: "",
  delivery: "Mail-in (let's talk)",
  message: "Line one\nLine <two> & more text here",
  consent: "yes",
  hp: "",
  services: ["Xbox 360 RGH ($100)", "Switch Lite modchip ($140)"],
};

describe("escape helpers", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
  it("collapses newlines for headers", () => {
    expect(singleLine("a\r\nBcc: x@y.z\tb")).toBe("a Bcc: x@y.z b");
  });
  it("sanitizes filenames", () => {
    expect(safeFilename("C:\\fake\\..\\photo 1.JPG", "f.jpg")).toBe("photo 1.JPG");
    expect(safeFilename("...", "f.jpg")).toBe("f.jpg");
  });
});

describe("email rendering", () => {
  it("builds booking subjects with a count of extra services", () => {
    expect(buildSubject({ kind: "book", data: book })).toBe("New booking: Xbox 360 RGH +1 more — Sam");
  });
  it("builds quote subjects", () => {
    const q: QuoteInput = { ...book, requestType: "Electronic repair" };
    expect(buildSubject({ kind: "quote", data: q })).toBe("New quote: Electronic repair — Sam");
  });
  it("renders escaped HTML and a plain-text body", () => {
    const e = renderEmail({ kind: "book", data: book });
    expect(e.html).toContain("Line <two>".replace("<", "&lt;").replace(">", "&gt;"));
    expect(e.html).toContain("&amp; more");
    expect(e.html).not.toContain("<two>");
    expect(e.text).toContain("Services: Xbox 360 RGH ($100), Switch Lite modchip ($140)");
    expect(e.text).toContain("Phone: —");
    expect(e.replyTo).toBe("sam@example.com");
  });
  it("base64-encodes bytes", () => {
    expect(toBase64(new TextEncoder().encode("hello").buffer as ArrayBuffer)).toBe("aGVsbG8=");
  });
});

describe("validateFields", () => {
  it("normalizes email and accepts a valid quote", () => {
    const fd = new FormData();
    Object.entries({ ...book, email: " SAM@Example.com ", requestType: "General question" }).forEach(([k, v]) => {
      if (k !== "services") fd.append(k, String(v));
    });
    const r = validateFields("quote", fd);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.submission.data.email).toBe("sam@example.com");
  });
  it("requires consent", () => {
    const r = validateFields("book", new FormData());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors).toHaveProperty("consent");
  });
});

describe("isCrossSite", () => {
  const req = (h: Record<string, string>) => new Request("https://site.test/api/book", { method: "POST", headers: h });
  it("allows same origin and missing Origin", () => {
    expect(isCrossSite(req({ Origin: "https://site.test" }))).toBe(false);
    expect(isCrossSite(req({}))).toBe(false);
  });
  it("blocks other origins and cross-site fetch metadata", () => {
    expect(isCrossSite(req({ Origin: "https://evil.test" }))).toBe(true);
    expect(isCrossSite(req({ "Sec-Fetch-Site": "cross-site" }))).toBe(true);
  });
});

describe("MemoryRateLimiter", () => {
  it("allows N per window then blocks, and recovers after the window", () => {
    const rl = new MemoryRateLimiter(2, 1000);
    expect([rl.check("a", 0), rl.check("a", 10), rl.check("a", 20)]).toEqual([true, true, false]);
    expect(rl.check("b", 20)).toBe(true);
    expect(rl.check("a", 1011)).toBe(true);
  });
});

describe("env helpers", () => {
  const env = (EMAIL_MODE?: string) => ({ EMAIL_MODE }) as Env;
  it("detects Cloudflare test secrets", () => {
    expect(isTestTurnstileSecret("1x0000000000000000000000000000000AA")).toBe(true);
    expect(isTestTurnstileSecret("3x0000000000000000000000000000000AA")).toBe(true);
    expect(isTestTurnstileSecret("0x4AAAAAAAreal")).toBe(false);
  });
  it("honours EMAIL_MODE=log only on localhost", () => {
    expect(isLocalHostname("127.0.0.1")).toBe(true);
    expect(emailMode(env("log"), "localhost")).toBe("log");
    expect(emailMode(env("log"), "mod-labs.workers.dev")).toBe("send");
    expect(emailMode(env(undefined), "localhost")).toBe("send");
  });
});

describe("checkSiteverify", () => {
  const expectBook = { hostname: "site.test", action: "book" };
  it("requires success, matching hostname and (if present) matching action", () => {
    expect(checkSiteverify({ success: true, hostname: "site.test" }, expectBook)).toBe("ok");
    expect(checkSiteverify({ success: true, hostname: "SITE.test", action: "book" }, expectBook)).toBe("ok");
    expect(checkSiteverify({ success: false, hostname: "site.test" }, expectBook)).toBe("failed");
    expect(checkSiteverify({ success: true, hostname: "other.test" }, expectBook)).toBe("failed");
    expect(checkSiteverify({ success: true, hostname: "site.test", action: "quote" }, expectBook)).toBe("failed");
  });
  it("skips the hostname check when expectation is null (test keys return example.com)", () => {
    expect(checkSiteverify({ success: true, hostname: "example.com" }, { hostname: null, action: "book" })).toBe("ok");
  });
});

describe("bounded body reading", () => {
  it("byteLimitStream passes data under the limit and errors past it", async () => {
    let exceeded = false;
    const src = new Response(new Uint8Array(10)).body!;
    await expect(new Response(src.pipeThrough(byteLimitStream(10))).arrayBuffer()).resolves.toHaveProperty("byteLength", 10);
    const big = new Response(new Uint8Array(11)).body!;
    await expect(new Response(big.pipeThrough(byteLimitStream(10, () => (exceeded = true)))).arrayBuffer()).rejects.toThrow();
    expect(exceeded).toBe(true);
  });
  it("parses a normal form body", async () => {
    const fd = new FormData();
    fd.append("name", "Sam");
    const enc = new Response(fd);
    const bytes = new Uint8Array(await enc.arrayBuffer());
    const req = new Request("https://site.test/api/book", {
      method: "POST",
      body: bytes,
      headers: { "Content-Type": enc.headers.get("Content-Type") ?? "", "Content-Length": String(bytes.byteLength) },
    });
    const r = await readFormDataLimited(req, 1_000_000);
    expect(r.ok && r.formData.get("name")).toBe("Sam");
  });
  it("rejects unsupported content types", async () => {
    const req = new Request("https://site.test/api/book", {
      method: "POST",
      body: "{}",
      headers: { "Content-Type": "application/json", "Content-Length": "2" },
    });
    expect(await readFormDataLimited(req, 100)).toEqual({ ok: false, reason: "unsupported" });
  });
});
