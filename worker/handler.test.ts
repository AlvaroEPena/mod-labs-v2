import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { Env } from "./lib/env";
import { memoryLimiter } from "./lib/ratelimit";
import { RESEND_URL, TURNSTILE_VERIFY_URL } from "./lib/integrations";
import { PHOTO_MAX_BYTES } from "../src/lib/forms/schema";

const ORIGIN = "https://mod-labs.example.workers.dev";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response("asset", { status: 200 })) } as unknown as Fetcher,
    TURNSTILE_SECRET_KEY: "test-secret",
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
  message: "Hi Al, I'd like to get my console modded next week please.",
  consent: "yes",
  company: "",
  "cf-turnstile-response": "XXXX.DUMMY.TOKEN.XXXX",
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
function post(path: string, body: FormData, opts: { json?: boolean; headers?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = {
    "CF-Connecting-IP": `203.0.113.${++ipCounter % 250}`,
    Origin: ORIGIN,
    ...opts.headers,
  };
  if (opts.json !== false) headers.Accept = "application/json";
  return new Request(`${ORIGIN}${path}`, { method: "POST", body, headers });
}

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[];
let turnstileSuccess: boolean;
let resendStatus: number;

beforeEach(() => {
  calls = [];
  turnstileSuccess = true;
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
      if (url === TURNSTILE_VERIFY_URL) {
        return Response.json(turnstileSuccess ? { success: true } : { success: false, "error-codes": ["invalid-input-response"] });
      }
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
  it("succeeds in log mode without calling Resend", async () => {
    const res = await worker.fetch(post("/api/book", bookForm()), makeEnv({ EMAIL_MODE: "log", RESEND_API_KEY: undefined }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(resendCalls()).toHaveLength(0);
    const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
    expect(logged).toContain("New booking: Switch OLED modchip, Kamikaze — Jordan Tester");
  });

  it("sends via Resend in send mode with reply_to and escaped HTML", async () => {
    const fd = bookForm({ name: "<b>Evil</b> Name", message: "<script>alert(1)</script> please mod my switch" });
    const res = await worker.fetch(post("/api/book", fd), makeEnv());
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
    await worker.fetch(post("/api/book", bookForm(), { headers: { "CF-Connecting-IP": "198.51.100.7" } }), makeEnv({ EMAIL_MODE: "log" }));
    const body = calls.find((c) => c.url === TURNSTILE_VERIFY_URL)?.init?.body as FormData;
    expect(body.get("secret")).toBe("test-secret");
    expect(body.get("response")).toBe("XXXX.DUMMY.TOKEN.XXXX");
    expect(body.get("remoteip")).toBe("198.51.100.7");
  });

  it("uses EMAIL_FROM when set", async () => {
    await worker.fetch(post("/api/book", bookForm()), makeEnv({ EMAIL_FROM: "Mod Labs <leads@modlabs.test>" }));
    expect(resendPayload().from).toBe("Mod Labs <leads@modlabs.test>");
  });

  it("returns validation errors with fieldErrors", async () => {
    const fd = bookForm({ email: "not-an-email", message: "too short", services: [] });
    const res = await worker.fetch(post("/api/book", fd), makeEnv());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: false; error: string; fieldErrors: Record<string, string[]> };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("validation");
    expect(Object.keys(body.fieldErrors).sort()).toEqual(["email", "message", "services"]);
    expect(body.fieldErrors.email?.[0]).toBe("Please enter a valid email address.");
    expect(resendCalls()).toHaveLength(0);
  });

  it("rejects unknown service values", async () => {
    const res = await worker.fetch(post("/api/book", bookForm({ services: ["Free games ($0)"] })), makeEnv());
    expect(res.status).toBe(400);
  });

  it("pretends success on honeypot and sends nothing", async () => {
    const res = await worker.fetch(post("/api/book", bookForm({ company: "Spam LLC" })), makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(calls).toHaveLength(0);
  });

  it("returns captcha (403) when Turnstile rejects", async () => {
    turnstileSuccess = false;
    const res = await worker.fetch(post("/api/book", bookForm()), makeEnv());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: "captcha" });
    expect(resendCalls()).toHaveLength(0);
  });

  it("returns captcha without calling siteverify when the token is missing", async () => {
    const res = await worker.fetch(post("/api/book", bookForm({ "cf-turnstile-response": "" })), makeEnv());
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("returns not_configured (503) in send mode without Resend key or inbox", async () => {
    for (const env of [makeEnv({ RESEND_API_KEY: undefined }), makeEnv({ LEAD_EMAIL_TO: "" })]) {
      const res = await worker.fetch(post("/api/book", bookForm()), env);
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ ok: false, error: "not_configured" });
    }
    expect(resendCalls()).toHaveLength(0);
  });

  it("defaults to send mode when EMAIL_MODE is unset", async () => {
    const res = await worker.fetch(post("/api/book", bookForm()), makeEnv({ EMAIL_MODE: undefined, RESEND_API_KEY: undefined }));
    expect(res.status).toBe(503);
  });

  it("returns not_configured when the Turnstile secret is missing", async () => {
    const res = await worker.fetch(post("/api/book", bookForm()), makeEnv({ TURNSTILE_SECRET_KEY: undefined }));
    expect(res.status).toBe(503);
  });

  it("returns server (502) when Resend fails, logging only the status", async () => {
    resendStatus = 422;
    const res = await worker.fetch(post("/api/book", bookForm()), makeEnv());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, error: "server" });
    expect(console.error).toHaveBeenCalledWith("resend send failed", 422);
  });

  it("rejects bodies whose Content-Length exceeds the limit", async () => {
    const req = post("/api/book", bookForm(), { headers: { "Content-Length": String(9 * 1024 * 1024) } });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ ok: false, error: "too_large" });
    expect(calls).toHaveLength(0);
  });

  it("rejects cross-origin posts with 403", async () => {
    const res = await worker.fetch(post("/api/book", bookForm(), { headers: { Origin: "https://evil.example" } }), makeEnv());
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("rejects Origin: null", async () => {
    const res = await worker.fetch(post("/api/book", bookForm(), { headers: { Origin: "null" } }), makeEnv());
    expect(res.status).toBe(403);
  });

  it("rate limits after 5 requests per IP (in-memory fallback)", async () => {
    const env = makeEnv({ EMAIL_MODE: "log" });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await worker.fetch(post("/api/book", bookForm(), { headers: { "CF-Connecting-IP": "192.0.2.1" } }), env);
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("uses the rate limit binding when configured", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const res = await worker.fetch(post("/api/book", bookForm()), makeEnv({ FORM_RATE_LIMITER: { limit } as unknown as RateLimit }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ ok: false, error: "rate_limited" });
    expect(limit).toHaveBeenCalledWith({ key: expect.stringMatching(/^form:/) });
  });
});

describe("no-JS form posts (303 redirects)", () => {
  it("redirects to /book?sent=1 on success", async () => {
    const res = await worker.fetch(post("/api/book", bookForm(), { json: false }), makeEnv({ EMAIL_MODE: "log" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`${ORIGIN}/book?sent=1`);
  });

  it("redirects to /quote?error=validation on invalid input", async () => {
    const res = await worker.fetch(post("/api/quote", quoteForm({ email: "x" }), { json: false }), makeEnv());
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`${ORIGIN}/quote?error=validation`);
  });

  it("redirects with the captcha code", async () => {
    turnstileSuccess = false;
    const res = await worker.fetch(post("/api/book", bookForm(), { json: false }), makeEnv());
    expect(res.headers.get("Location")).toBe(`${ORIGIN}/book?error=captcha`);
  });
});

describe("POST /api/quote", () => {
  it("sends photos as base64 attachments", async () => {
    const photo = new File([JPEG], "IMG_0001.jpg", { type: "image/jpeg" });
    const png = new File([PNG], "../../etc/board<1>.png", { type: "image/png" });
    const res = await worker.fetch(post("/api/quote", quoteForm({}, [photo, png])), makeEnv());
    expect(res.status).toBe(200);
    const p = resendPayload();
    expect(p.subject).toBe("New quote: GWii commission — Jordan Tester");
    const atts = p.attachments as { filename: string; content: string; content_type: string }[];
    expect(atts).toHaveLength(2);
    expect(atts[0]).toEqual({ filename: "IMG_0001.jpg", content: btoa(String.fromCharCode(...JPEG)), content_type: "image/jpeg" });
    expect(atts[1]?.filename).toBe("board_1_.png");
  });

  it("ignores empty file inputs", async () => {
    const empty = new File([], "", { type: "application/octet-stream" });
    const res = await worker.fetch(post("/api/quote", quoteForm({ requestType: "Electronic repair" }, [empty])), makeEnv());
    expect(res.status).toBe(200);
    expect(resendPayload().attachments).toBeUndefined();
  });

  it("logs attachment metadata (not base64) in log mode", async () => {
    const photo = new File([JPEG], "a.jpg", { type: "image/jpeg" });
    const res = await worker.fetch(post("/api/quote", quoteForm({}, [photo])), makeEnv({ EMAIL_MODE: "log" }));
    expect(res.status).toBe(200);
    const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
    expect(logged).toContain('"name":"a.jpg"');
    expect(logged).not.toContain(btoa(String.fromCharCode(...JPEG)));
  });

  it("rejects more than 3 photos", async () => {
    const files = Array.from({ length: 4 }, (_, i) => new File([JPEG], `p${i}.jpg`, { type: "image/jpeg" }));
    const res = await worker.fetch(post("/api/quote", quoteForm({}, files)), makeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "validation", fieldErrors: { photos: [expect.any(String)] } });
  });

  it("rejects a photo over the size limit with too_large", async () => {
    const big = new Uint8Array(PHOTO_MAX_BYTES + 1);
    big.set(JPEG);
    const res = await worker.fetch(post("/api/quote", quoteForm({}, [new File([big], "big.jpg", { type: "image/jpeg" })])), makeEnv());
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ ok: false, error: "too_large" });
  });

  it("rejects non-image types", async () => {
    const res = await worker.fetch(post("/api/quote", quoteForm({}, [new File(["%PDF-1.7"], "x.pdf", { type: "application/pdf" })])), makeEnv());
    expect(res.status).toBe(400);
  });

  it("rejects files whose bytes don't match the declared image type", async () => {
    const fake = new File(["<html>not a jpeg</html>"], "fake.jpg", { type: "image/jpeg" });
    const res = await worker.fetch(post("/api/quote", quoteForm({}, [fake])), makeEnv());
    expect(res.status).toBe(400);
    expect(resendCalls()).toHaveLength(0);
  });

  it("rejects an invalid request type", async () => {
    const res = await worker.fetch(post("/api/quote", quoteForm({ requestType: "Preloaded games" })), makeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ fieldErrors: { requestType: ["Choose a request type."] } });
  });
});
