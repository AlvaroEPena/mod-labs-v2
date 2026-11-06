import { describe, expect, it } from "vitest";
import { buildSubject, renderEmail, toBase64 } from "./email";
import { escapeHtml, safeFilename, singleLine } from "./escape";
import { isCrossSite } from "./guards";
import { MemoryRateLimiter } from "./ratelimit";
import { emailMode, isLocalHostname, isTestTurnstileSecret, type Env } from "./env";
import { checkSiteverify } from "./integrations";
import { ipBucket } from "./ip";
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
  const expectBook = { hostname: "site.test", action: "book", isActionRequired: true };
  const bookVerdict = (data: Parameters<typeof checkSiteverify>[0]) => checkSiteverify(data, expectBook);
  it("requires success, a matching hostname and exactly the expected action (real secrets)", () => {
    expect(bookVerdict({ success: true, hostname: "site.test", action: "book" })).toBe("ok");
    expect(bookVerdict({ success: true, hostname: "SITE.test", action: "book" })).toBe("ok");
    expect(bookVerdict({ success: false, hostname: "site.test", action: "book" })).toBe("failed");
    expect(bookVerdict({ success: true, hostname: "other.test", action: "book" })).toBe("failed");
    expect(bookVerdict({ success: true, hostname: "site.test", action: "quote" })).toBe("failed");
  });
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["differently cased", "Book"],
    ["padded", " book"],
  ])("fails a %s action when the action is required (L4)", (_label, action) => {
    expect(bookVerdict({ success: true, hostname: "site.test", action })).toBe("failed");
  });
  it("with a test secret, accepts a missing action but still refuses a wrong one", () => {
    const testKeys = { hostname: null, action: "book", isActionRequired: false };
    expect(checkSiteverify({ success: true, hostname: "example.com" }, testKeys)).toBe("ok");
    expect(checkSiteverify({ success: true, hostname: "example.com", action: "" }, testKeys)).toBe("ok");
    expect(checkSiteverify({ success: true, hostname: "example.com", action: "quote" }, testKeys)).toBe(
      "failed",
    );
  });
  it("skips the hostname check when expectation is null (test keys return example.com)", () => {
    const local = { hostname: null, action: "book", isActionRequired: true };
    expect(checkSiteverify({ success: true, hostname: "example.com", action: "book" }, local)).toBe("ok");
  });
});

describe("ipBucket", () => {
  it("keeps an IPv4 address as its own bucket", () => {
    expect(ipBucket("192.0.2.10")).toBe("v4:192.0.2.10");
    expect(ipBucket(" 192.0.2.10 ")).toBe("v4:192.0.2.10");
    expect(ipBucket("192.0.2.11")).not.toBe(ipBucket("192.0.2.10"));
  });

  it("groups IPv6 addresses by /64, whatever their spelling", () => {
    const bucket = ipBucket("2001:db8:1:2::1");
    expect(bucket).toBe("v6:2001:db8:1:2::/64");
    for (const sameNetwork of [
      "2001:0DB8:0001:0002:ffff:ffff:ffff:ffff",
      "2001:db8:1:2:aaaa:bbbb:cccc:dddd",
      "2001:db8:1:2::",
      "2001:db8:1:2:0:0:192.0.2.1",
    ]) {
      expect(ipBucket(sameNetwork), sameNetwork).toBe(bucket);
    }
    expect(ipBucket("2001:db8:1:3::1")).toBe("v6:2001:db8:1:3::/64");
    expect(ipBucket("2001:db8::1")).toBe("v6:2001:db8:0:0::/64");
    expect(ipBucket("::1")).toBe("v6:0:0:0:0::/64");
  });

  it("treats IPv4-mapped IPv6 as the IPv4 address", () => {
    expect(ipBucket("::ffff:192.0.2.10")).toBe("v4:192.0.2.10");
    expect(ipBucket("::ffff:c000:20a")).toBe("v4:192.0.2.10");
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["   "],
    ["unknown"],
    ["256.1.1.1"],
    ["1.2.3"],
    ["1.2.3.4.5"],
    ["01.2.3.4"],
    ["1.2.3.4, 5.6.7.8"],
    ["1::2::3"],
    ["2001:db8::g"],
    ["1:2:3:4:5:6:7:8:9"],
    ["1:2:3:4:5:6:7"],
    [":1:2:3:4:5:6:7"],
    ["1:2:3:4::5:6:7:8"],
    ["fe80::1%eth0"],
    ["::ffff:999.0.2.1"],
    ["a".repeat(46)],
  ])("returns null for a missing or malformed address: %j", (raw) => {
    expect(ipBucket(raw)).toBeNull();
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
