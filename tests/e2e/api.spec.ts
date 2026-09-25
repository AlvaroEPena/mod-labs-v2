/** Form API contract (spec §6) exercised directly with the request fixture. */
import { test, expect, freshIp, makeJpeg } from "./fixtures";

const JSON_ACCEPT = { Accept: "application/json" };
const TOKEN = "XXXX.DUMMY.TOKEN.XXXX"; // accepted by the always-pass Turnstile test secret

const validBook = {
  name: "Api Tester",
  email: "api@example.com",
  delivery: "Local drop-off (Seattle)",
  services: "Switch OLED modchip, Kamikaze ($160)",
  message: "Testing the booking API end to end, please ignore.",
  consent: "yes",
  hp_7f3: "",
};

test.describe("form API", () => {
  test("POST /api/book without a Turnstile token → 403 captcha JSON", async ({ request, clientIp }) => {
    const res = await request.post("/api/book", {
      headers: { ...JSON_ACCEPT, "CF-Connecting-IP": clientIp },
      multipart: validBook,
    });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: "captcha" });
    expect(res.headers()["content-type"]).toContain("application/json");
  });

  test("POST /api/book with invalid fields → 400 fieldErrors", async ({ request, clientIp }) => {
    const res = await request.post("/api/book", {
      headers: { ...JSON_ACCEPT, "CF-Connecting-IP": clientIp },
      multipart: { ...validBook, email: "nope", message: "short", services: "Free games ($0)", "cf-turnstile-response": TOKEN },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("validation");
    expect(Object.keys(body.fieldErrors)).toEqual(expect.arrayContaining(["email", "message", "services"]));
  });

  test("POST /api/book valid + token → 200 ok (EMAIL_MODE=log)", async ({ request, clientIp }) => {
    const res = await request.post("/api/book", {
      headers: { ...JSON_ACCEPT, "CF-Connecting-IP": clientIp },
      multipart: { ...validBook, "cf-turnstile-response": TOKEN },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  test("POST /api/quote with a real JPEG → 200; with a fake JPEG → 400 photos error", async ({ request, clientIp }) => {
    const base = {
      name: "Api Tester",
      email: "api@example.com",
      delivery: "Mail-in (let's talk)",
      requestType: "Electronic repair",
      message: "Testing the quote API with a photo attachment.",
      consent: "yes",
      "cf-turnstile-response": TOKEN,
    };
    const ok = await request.post("/api/quote", {
      headers: { ...JSON_ACCEPT, "CF-Connecting-IP": clientIp },
      multipart: { ...base, photos: { name: "p.jpg", mimeType: "image/jpeg", buffer: await makeJpeg(300, 200) } },
    });
    expect(ok.status()).toBe(200);

    const bad = await request.post("/api/quote", {
      headers: { ...JSON_ACCEPT, "CF-Connecting-IP": clientIp },
      multipart: { ...base, photos: { name: "p.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not really a jpeg") } },
    });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).fieldErrors).toHaveProperty("photos");
  });

  test("GET /api/book → 405 with Allow: POST", async ({ request }) => {
    const res = await request.get("/api/book", { headers: JSON_ACCEPT });
    expect(res.status()).toBe(405);
    expect(res.headers()["allow"]).toBe("POST");
  });

  test("a cross-origin Origin header → 403", async ({ request, clientIp }) => {
    const res = await request.post("/api/book", {
      headers: { ...JSON_ACCEPT, Origin: "https://evil.example", "CF-Connecting-IP": clientIp },
      multipart: { ...validBook, "cf-turnstile-response": TOKEN },
    });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: "server" });
  });

  test("unknown /api route → 404 JSON", async ({ request }) => {
    const res = await request.post("/api/nope", { headers: JSON_ACCEPT });
    expect(res.status()).toBe(404);
  });

  test("no-JS form post (no Accept: json) gets a 303 back to the form page", async ({ request, clientIp }) => {
    const res = await request.post("/api/book", {
      headers: { "CF-Connecting-IP": clientIp },
      multipart: validBook,
      maxRedirects: 0,
    });
    expect(res.status()).toBe(303);
    expect(res.headers()["location"]).toMatch(/\/book\?error=captcha$/);
  });

  test("API responses carry security headers", async ({ request }) => {
    const res = await request.get("/api/book");
    const h = res.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["content-security-policy"]).toContain("default-src 'none'");
    expect(h["cache-control"]).toBe("no-store");
  });

  test("rate limit: the 6th POST within a minute from one IP → 429", async ({ request }) => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request.post("/api/book", {
        headers: { ...JSON_ACCEPT, "CF-Connecting-IP": ip },
        multipart: { name: "x" },
      });
      statuses.push(res.status());
    }
    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
