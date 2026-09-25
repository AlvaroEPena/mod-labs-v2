import { describe, expect, it } from "vitest";
import { buildSubject, renderEmail, toBase64 } from "./email";
import { escapeHtml, safeFilename, singleLine } from "./escape";
import { isCrossSite } from "../handler";
import { MemoryRateLimiter } from "./ratelimit";
import { validateFields } from "./validate";
import type { BookInput, QuoteInput } from "../../src/lib/forms/schema";

const book: BookInput = {
  name: "Sam",
  email: "sam@example.com",
  phone: "",
  delivery: "Mail-in (let's talk)",
  message: "Line one\nLine <two> & more text here",
  consent: "yes",
  company: "",
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
