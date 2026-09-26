import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { Env } from "./lib/env";
import { memoryLimiter } from "./lib/ratelimit";
import { RESEND_URL, TURNSTILE_VERIFY_URL } from "./lib/integrations";
import { MAX_BODY_BYTES } from "./handler";
import { fieldNames, PHOTO_MAX_BYTES } from "../src/lib/forms/schema";

const HOST = "mod-labs.example.workers.dev";
const ORIGIN = `https://${HOST}`;
const LOCAL = "http://127.0.0.1:8799";
const TEST_SECRET = "1x0000000000000000000000000000000AA";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const b64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8));

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response("asset", { status: 200 })) } as unknown as Fetcher,
    TURNSTILE_SECRET_KEY: "real-secret",
    RESEND_API_KEY: "re_test",
    LEAD_EMAIL_TO: "al@example.com",
    EMAIL_MODE: "send",
    ...overrides,
  };
}

const baseFields = {
  name: "Jordan Tester",
  email: "Jordan@Example.com",
  phone: "(206) 555-0100",
  delivery: "Local drop-off (Seattle)",
  message: "Hi Alvaro, I'd like to get my console modded next week please.",
  consent: "yes",
  [fieldNames.honeypot]: "",
  [fieldNames.turnstile]: "XXXX.DUMMY.TOKEN.XXXX",
};

function bookForm(extra: Record<string, string | string[]> = {}): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...baseFields, ...extra })) {
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
    else fd.append(k, v);
  }
  if (!("services" in extra)) fd.append("services", "Switch OLED modchip, Kamikaze ($160)");
  return fd;
}

function quoteForm(extra: Record<string, string> = {}, files: File[] = []): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...baseFields, requestType: "Custom build commission: GWii ($900)", ...extra })) {
    fd.append(k, v);
  }
  for (const f of files) fd.append("photos", f);
  return fd;
}

let ipCounter = 0;
interface PostOpts {
  json?: boolean;
  origin?: string;
  headers?: Record<string, string>;
}

/** Serialize FormData like a browser does (multipart body + Content-Length). */
async function post(path: string, body: FormData, opts: PostOpts = {}): Promise<Request> {
  const origin = opts.origin ?? ORIGIN;
  const encoded = new Response(body);
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  const headers: Record<string, string> = {
    "Content-Type": encoded.headers.get("Content-Type") ?? "",
    "Content-Length": String(bytes.byteLength),
    "CF-Connecting-IP": `203.0.113.${++ipCounter % 250}`,
    Origin: origin,
    ...opts.headers,
  };
  if (opts.json !== false) headers.Accept = "application/json";
  return new Request(`${origin}${path}`, { method: "POST", body: bytes, headers });
}

/** A request whose body is streamed in chunks (no buffering), like a chunked upload. */
function streamedRequest(totalBytes: number, headers: Record<string, string>): Request {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) return controller.close();
      const n = Math.min(chunk.byteLength, totalBytes - sent);
      sent += n;
      controller.enqueue(chunk.subarray(0, n));
    },
  });
  return new Request(`${ORIGIN}/api/quote`, {
    method: "POST",
    body: stream,
    headers: { "Content-Type": "multipart/form-data; boundary=x", Accept: "application/json", ...headers },
    duplex: "half",
  } as RequestInit);
}

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[];
let siteverify: Record<string, unknown>;
let resendStatus: number;

beforeEach(() => {
  calls = [];
  siteverify = { success: true, hostname: HOST };
  resendStatus = 200;
  memoryLimiter.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({ url, init });
      if (url === TURNSTILE_VERIFY_URL) return Response.json(siteverify);
      if (url === RESEND_URL) return Response.json({ id: "email_123" }, { status: resendStatus });
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const resendCalls = () => calls.filter((c) => c.url === RESEND_URL);
const resendPayload = () => JSON.parse(String(resendCalls()[0]?.init?.body)) as Record<string, unknown>;
const logged = () => vi.mocked(console.log).mock.calls.flat().join(" ");

describe("routing", () => {
  it("serves non-API paths from static assets", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request(`${ORIGIN}/gallery`), env);
    expect(await res.text()).toBe("asset");
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
  });

  it("returns 404 JSON for unknown API paths", async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/api/nope`, { method: "POST" }), makeEnv());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: "server" });
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("returns 405 for non-POST on form endpoints", async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/api/book`), makeEnv());
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });
});

describe("POST /api/book", () => {
  it("succeeds in log mode on localhost without calling Resend", async () => {
    const env = makeEnv({ EMAIL_MODE: "log", RESEND_API_KEY: undefined, TURNSTILE_SECRET_KEY: TEST_SECRET });
    siteverify = { success: true, hostname: "example.com" }; // what Cloudflare's test secret returns
    const res = await worker.fetch(await post("/api/book", bookForm(), { origin: LOCAL }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(resendCalls()).toHaveLength(0);
    expect(logged()).toContain("New booking: Switch OLED modchip, Kamikaze — Jordan Tester");
  });

  it("sends via Resend in send mode with reply_to and escaped HTML", async () => {
    const fd = bookForm({ name: "<b>Evil</b> Name", message: "<script>alert(1)</script> please mod my switch" });
    const res = await worker.fetch(await post("/api/book", fd), makeEnv());
    expect(res.status).toBe(200);
    const p = resendPayload();
    expect(p.from).toBe("Mod Labs <onboarding@resend.dev>");
    expect(p.to).toEqual(["al@example.com"]);
    expect(p.reply_to).toBe("jordan@example.com");
    expect(String(p.html)).not.toContain("<script>");
    expect(String(p.html)).toContain("&lt;script&gt;");
    expect(String(p.html)).toContain("&lt;b&gt;Evil&lt;/b&gt;");
    expect(p.attachments).toBeUndefined();
    expect(resendCalls()[0]?.init?.headers).toMatchObject({ Authorization: "Bearer re_test" });
  });

  it("forwards the Turnstile token, secret and client IP", async () => {
    await worker.fetch(await post("/api/book", bookForm(), { headers: { "CF-Connecting-IP": "198.51.100.7" } }), makeEnv());
    const body = calls.find((c) => c.url === TURNSTILE_VERIFY_URL)?.init?.body as FormData;
    expect(body.get("secret")).toBe("real-secret");
    expect(body.get("response")).toBe("XXXX.DUMMY.TOKEN.XXXX");
    expect(body.get("remoteip")).toBe("198.51.100.7");
  });

  it("uses EMAIL_FROM when set", async () => {
    await worker.fetch(await post("/api/book", bookForm()), makeEnv({ EMAIL_FROM: "Mod Labs <leads@modlabs.test>" }));
    expect(resendPayload().from).toBe("Mod Labs <leads@modlabs.test>");
  });

  it("returns validation errors with fieldErrors", async () => {
    const fd = bookForm({ email: "not-an-email", message: "too short", services: [] });
    const res = await worker.fetch(await post("/api/book", fd), makeEnv());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: false; error: string; fieldErrors: Record<string, string[]> };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("validation");
    expect(Object.keys(body.fieldErrors).sort()).toEqual(["email", "message", "services"]);
    expect(body.fieldErrors.email?.[0]).toBe("Please enter a valid email address.");
    expect(resendCalls()).toHaveLength(0);
  });

  it("rejects unknown service values", async () => {
    const res = await worker.fetch(await post("/api/book", bookForm({ services: ["Free games ($0)"] })), makeEnv());
    expect(res.status).toBe(400);
  });

  it("pretends success on honeypot, sends nothing, and logs kind/count only", async () => {
    const res = await worker.fetch(await post("/api/book", bookForm({ [fieldNames.honeypot]: "Spam LLC" })), makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(calls).toHaveLength(0);
    const warned = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(warned).toContain("honeypot tripped");
    expect(warned).toContain('"kind":"book"');
    expect(warned).not.toContain("Jordan");
    expect(warned).not.toContain("Spam LLC");
  });

  it("trips the honeypot when any duplicate value is filled", async () => {
    const fd = bookForm();
    fd.append(fieldNames.honeypot, "spam");
    const res = await worker.fetch(await post("/api/book", fd), makeEnv());
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it("ignores a legacy `company` field (browser autofill)", async () => {
    const res = await worker.fetch(await post("/api/book", bookForm({ company: "Acme Inc" })), makeEnv());
    expect(res.status).toBe(200);
    expect(resendCalls()).toHaveLength(1);
  });

  it("returns captcha (403) when Turnstile rejects", async () => {
    siteverify = { success: false, "error-codes": ["invalid-input-response"] };
    const res = await worker.fetch(await post("/api/book", bookForm()), makeEnv());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: "captcha" });
    expect(resendCalls()).toHaveLength(0);
  });

  it("returns captcha without calling siteverify when the token is missing", async () => {
    const res = await worker.fetch(await post("/api/book", bookForm({ [fieldNames.turnstile]: "" })), makeEnv());
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("returns not_configured (503) in send mode without Resend key or inbox", async () => {
    for (const env of [makeEnv({ RESEND_API_KEY: undefined }), makeEnv({ LEAD_EMAIL_TO: "" })]) {
      const res = await worker.fetch(await post("/api/book", bookForm()), env);
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ ok: false, error: "not_configured" });
    }
    expect(resendCalls()).toHaveLength(0);
  });

  it("defaults to send mode when EMAIL_MODE is unset", async () => {
    const res = await worker.fetch(await post("/api/book", bookForm()), makeEnv({ EMAIL_MODE: undefined, RESEND_API_KEY: undefined }));
    expect(res.status).toBe(503);
  });

  it("returns not_configured when the Turnstile secret is missing", async () => {
    const res = await worker.fetch(await post("/api/book", bookForm()), makeEnv({ TURNSTILE_SECRET_KEY: undefined }));
    expect(res.status).toBe(503);
  });

  it("returns server (502) when Resend fails, logging only the status", async () => {
    resendStatus = 422;
    const res = await worker.fetch(await post("/api/book", bookForm()), makeEnv());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, error: "server" });
    expect(console.error).toHaveBeenCalledWith("resend send failed", 422);
  });

  it("rejects cross-origin posts with 403", async () => {
    const res = await worker.fetch(await post("/api/book", bookForm(), { headers: { Origin: "https://evil.example" } }), makeEnv());
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("rejects Origin: null", async () => {
    const res = await worker.fetch(await post("/api/book", bookForm(), { headers: { Origin: "null" } }), makeEnv());
    expect(res.status).toBe(403);
  });

  it("rate limits after 5 requests per IP (in-memory fallback)", async () => {
    const env = makeEnv();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await worker.fetch(await post("/api/book", bookForm(), { headers: { "CF-Connecting-IP": "192.0.2.1" } }), env);
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("uses the rate limit binding when configured", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const res = await worker.fetch(await post("/api/book", bookForm()), makeEnv({ FORM_RATE_LIMITER: { limit } as unknown as RateLimit }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ ok: false, error: "rate_limited" });
    expect(limit).toHaveBeenCalledWith({ key: expect.stringMatching(/^form:/) });
  });
});

describe("body size limits (M1)", () => {
  it("rejects a declared Content-Length over the limit before reading", async () => {
    const req = await post("/api/book", bookForm(), { headers: { "Content-Length": String(MAX_BODY_BYTES + 1) } });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ ok: false, error: "too_large" });
    expect(calls).toHaveLength(0);
  });

  it("rejects requests without Content-Length (411) — e.g. a 12 MB chunked stream", async () => {
    const res = await worker.fetch(streamedRequest(12 * 1024 * 1024, { Origin: ORIGIN }), makeEnv());
    expect(res.status).toBe(411);
    expect(await res.json()).toMatchObject({ ok: false, error: "too_large" });
    expect(calls).toHaveLength(0);
  });

  it("enforces the limit while streaming when Content-Length understates the body", async () => {
    const res = await worker.fetch(streamedRequest(12 * 1024 * 1024, { Origin: ORIGIN, "Content-Length": "1000" }), makeEnv());
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ ok: false, error: "too_large" });
    expect(calls).toHaveLength(0);
  });

  it("rejects a non-numeric Content-Length", async () => {
    const res = await worker.fetch(await post("/api/book", bookForm(), { headers: { "Content-Length": "abc" } }), makeEnv());
    expect(res.status).toBe(411);
  });
});

describe("Turnstile hardening", () => {
  it("refuses to run in send mode with a Cloudflare test secret (H1)", async () => {
    for (const secret of [TEST_SECRET, "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA"]) {
      const res = await worker.fetch(await post("/api/book", bookForm()), makeEnv({ TURNSTILE_SECRET_KEY: secret }));
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ ok: false, error: "not_configured" });
    }
    expect(calls).toHaveLength(0);
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).toContain("TEST secret");
  });

  it("refuses a test secret on localhost too when not in log mode", async () => {
    const res = await worker.fetch(await post("/api/book", bookForm(), { origin: LOCAL }), makeEnv({ TURNSTILE_SECRET_KEY: TEST_SECRET }));
    expect(res.status).toBe(503);
  });

  it("rejects a token solved on a different hostname (L3)", async () => {
    siteverify = { success: true, hostname: "evil.example" };
    const res = await worker.fetch(await post("/api/book", bookForm()), makeEnv());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "captcha" });
    expect(resendCalls()).toHaveLength(0);
  });

  it("rejects a token issued for the other form's action", async () => {
    siteverify = { success: true, hostname: HOST, action: "quote" };
    const res = await worker.fetch(await post("/api/book", bookForm()), makeEnv());
    expect(res.status).toBe(403);
  });

  it("accepts a matching action", async () => {
    siteverify = { success: true, hostname: HOST, action: "book" };
    const res = await worker.fetch(await post("/api/book", bookForm()), makeEnv());
    expect(res.status).toBe(200);
  });

  it("skips the hostname check on localhost", async () => {
    siteverify = { success: true, hostname: "example.com" };
    const res = await worker.fetch(await post("/api/book", bookForm(), { origin: LOCAL }), makeEnv());
    expect(res.status).toBe(200);
  });
});

describe("EMAIL_MODE=log is localhost-only (L2)", () => {
  it("behaves as send mode on a public host (no fake success when keys are missing)", async () => {
    const res = await worker.fetch(await post("/api/book", bookForm()), makeEnv({ EMAIL_MODE: "log", RESEND_API_KEY: undefined }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "not_configured" });
    expect(logged()).not.toContain("[form email]");
  });

  it("actually sends on a public host even if EMAIL_MODE=log", async () => {
    const res = await worker.fetch(await post("/api/book", bookForm()), makeEnv({ EMAIL_MODE: "log" }));
    expect(res.status).toBe(200);
    expect(resendCalls()).toHaveLength(1);
  });

  it("refuses the test secret on a public host even if EMAIL_MODE=log", async () => {
    const res = await worker.fetch(await post("/api/book", bookForm()), makeEnv({ EMAIL_MODE: "log", TURNSTILE_SECRET_KEY: TEST_SECRET }));
    expect(res.status).toBe(503);
  });
});

describe("no-JS form posts (303 redirects)", () => {
  it("redirects to /book?sent=1 on success", async () => {
    const res = await worker.fetch(await post("/api/book", bookForm(), { json: false }), makeEnv());
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`${ORIGIN}/book?sent=1`);
  });

  it("redirects to /quote?error=validation on invalid input", async () => {
    const res = await worker.fetch(await post("/api/quote", quoteForm({ email: "x" }), { json: false }), makeEnv());
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`${ORIGIN}/quote?error=validation`);
  });

  it("redirects with the captcha code", async () => {
    siteverify = { success: false };
    const res = await worker.fetch(await post("/api/book", bookForm(), { json: false }), makeEnv());
    expect(res.headers.get("Location")).toBe(`${ORIGIN}/book?error=captcha`);
  });
});

describe("POST /api/quote", () => {
  it("sends photos as base64 attachments", async () => {
    const photo = new File([JPEG], "IMG_0001.jpg", { type: "image/jpeg" });
    const png = new File([PNG], "../../etc/board<1>.png", { type: "image/png" });
    const res = await worker.fetch(await post("/api/quote", quoteForm({}, [photo, png])), makeEnv());
    expect(res.status).toBe(200);
    const p = resendPayload();
    expect(p.subject).toBe("New quote: GWii commission — Jordan Tester");
    const atts = p.attachments as { filename: string; content: string; content_type: string }[];
    expect(atts).toHaveLength(2);
    expect(atts[0]).toEqual({ filename: "IMG_0001.jpg", content: b64(JPEG), content_type: "image/jpeg" });
    expect(atts[1]?.filename).toBe("board_1_.png");
  });

  it("ignores empty file inputs", async () => {
    const empty = new File([], "", { type: "application/octet-stream" });
    const res = await worker.fetch(await post("/api/quote", quoteForm({ requestType: "Electronic repair" }, [empty])), makeEnv());
    expect(res.status).toBe(200);
    expect(resendPayload().attachments).toBeUndefined();
  });

  it("logs attachment metadata (not base64) in log mode", async () => {
    const photo = new File([JPEG], "a.jpg", { type: "image/jpeg" });
    const res = await worker.fetch(await post("/api/quote", quoteForm({}, [photo]), { origin: LOCAL }), makeEnv({ EMAIL_MODE: "log" }));
    expect(res.status).toBe(200);
    expect(logged()).toContain('"name":"a.jpg"');
    expect(logged()).not.toContain(b64(JPEG));
  });

  it("rejects more than 3 photos", async () => {
    const files = Array.from({ length: 4 }, (_, i) => new File([JPEG], `p${i}.jpg`, { type: "image/jpeg" }));
    const res = await worker.fetch(await post("/api/quote", quoteForm({}, files)), makeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "validation", fieldErrors: { photos: [expect.any(String)] } });
  });

  it("rejects a photo over the size limit with too_large", async () => {
    const big = new Uint8Array(PHOTO_MAX_BYTES + 1);
    big.set(JPEG);
    const res = await worker.fetch(await post("/api/quote", quoteForm({}, [new File([big], "big.jpg", { type: "image/jpeg" })])), makeEnv());
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ ok: false, error: "too_large" });
  });

  it("rejects non-image types", async () => {
    const res = await worker.fetch(await post("/api/quote", quoteForm({}, [new File(["%PDF-1.7"], "x.pdf", { type: "application/pdf" })])), makeEnv());
    expect(res.status).toBe(400);
  });

  it("rejects files whose bytes don't match the declared image type", async () => {
    const fake = new File(["<html>not a jpeg</html>"], "fake.jpg", { type: "image/jpeg" });
    const res = await worker.fetch(await post("/api/quote", quoteForm({}, [fake])), makeEnv());
    expect(res.status).toBe(400);
    expect(resendCalls()).toHaveLength(0);
  });

  it("rejects an invalid request type", async () => {
    const res = await worker.fetch(await post("/api/quote", quoteForm({ requestType: "Preloaded games" })), makeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ fieldErrors: { requestType: ["Choose a request type."] } });
  });
});
