/** Small pure helpers: security checks, port parsing, git output, body limits, UI ordering. */
import { describe, expect, it } from "vitest";
import { looksLikeHeic } from "../../scripts/lib/process-photo.mjs";
import { DEFAULT_PORT, resolvePort } from "../lib/config.ts";
import { countChangedFiles } from "../lib/git-status.ts";
import { HttpError, readBodyLimited } from "../lib/http.ts";
import { isAllowedHost, isAllowedOrigin, isValidToken } from "../lib/security.ts";
import { moveBy, moveTo, placeNextTo, sameOrder } from "../public/order.js";

describe("security checks", () => {
  it("allows only 127.0.0.1 / localhost on our port as Host", () => {
    expect(isAllowedHost("127.0.0.1:4400", 4400)).toBe(true);
    expect(isAllowedHost("LOCALHOST:4400", 4400)).toBe(true);
    expect(isAllowedHost("127.0.0.1:4401", 4400)).toBe(false);
    expect(isAllowedHost("evil.example:4400", 4400)).toBe(false);
    expect(isAllowedHost("127.0.0.1", 4400)).toBe(false);
    expect(isAllowedHost(null, 4400)).toBe(false);
  });

  it("requires a same-origin Origin", () => {
    expect(isAllowedOrigin("http://127.0.0.1:4400", 4400)).toBe(true);
    expect(isAllowedOrigin("http://localhost:4400", 4400)).toBe(true);
    expect(isAllowedOrigin("https://127.0.0.1:4400", 4400)).toBe(false);
    expect(isAllowedOrigin("http://evil.example", 4400)).toBe(false);
    expect(isAllowedOrigin("null", 4400)).toBe(false);
    expect(isAllowedOrigin(null, 4400)).toBe(false);
  });

  it("compares tokens exactly", () => {
    expect(isValidToken("abc123", "abc123")).toBe(true);
    expect(isValidToken("abc124", "abc123")).toBe(false);
    expect(isValidToken("abc", "abc123")).toBe(false);
    expect(isValidToken(null, "abc123")).toBe(false);
  });
});

describe("resolvePort", () => {
  it("defaults to 4400 and accepts --port, --port= and ADMIN_PORT", () => {
    expect(resolvePort([], {})).toBe(DEFAULT_PORT);
    expect(resolvePort(["--port", "4410"], {})).toBe(4410);
    expect(resolvePort(["--port=4411"], {})).toBe(4411);
    expect(resolvePort([], { ADMIN_PORT: "4412" })).toBe(4412);
  });

  it("rejects nonsense ports", () => {
    expect(() => resolvePort(["--port", "80"], {})).toThrow(/Invalid port/);
    expect(() => resolvePort([], { ADMIN_PORT: "abc" })).toThrow(/Invalid port/);
  });
});

describe("countChangedFiles", () => {
  it("counts porcelain lines", () => {
    expect(countChangedFiles("")).toBe(0);
    expect(countChangedFiles(" M src/data/photos.json\n?? src/assets/gallery/photos/p0451.jpg\n")).toBe(2);
  });
});

describe("readBodyLimited", () => {
  it("reads bodies under the limit and refuses ones over it, even without Content-Length", async () => {
    const small = new Request("http://x/", { method: "POST", body: "12345" });
    expect(new TextDecoder().decode(await readBodyLimited(small, 5))).toBe("12345");

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(4));
        controller.close();
      },
    });
    const chunked = new Request("http://x/", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await expect(readBodyLimited(chunked, 6)).rejects.toSatisfy(
      (e) => e instanceof HttpError && e.status === 413,
    );
  });
});

describe("looksLikeHeic", () => {
  it("recognises the iPhone HEIC signature", () => {
    const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0]);
    expect(looksLikeHeic(heic)).toBe(true);
    expect(looksLikeHeic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });
});

describe("UI ordering helpers", () => {
  const ids = [1, 2, 3, 4];
  it("moves by a step, clamped at the ends", () => {
    expect(moveBy(ids, 3, -1)).toEqual([1, 3, 2, 4]);
    expect(moveBy(ids, 1, -1)).toEqual(ids);
    expect(moveBy(ids, 4, 1)).toEqual(ids);
  });

  it("moves to the cover spot or the end", () => {
    expect(moveTo(ids, 3, 0)).toEqual([3, 1, 2, 4]);
    expect(moveTo(ids, 1, ids.length)).toEqual([2, 3, 4, 1]);
    expect(moveTo(ids, 9, 0)).toEqual(ids);
  });

  it("places a dragged photo before or after the drop target", () => {
    expect(placeNextTo(ids, 1, 3, false)).toEqual([2, 1, 3, 4]);
    expect(placeNextTo(ids, 1, 3, true)).toEqual([2, 3, 1, 4]);
    expect(placeNextTo(ids, 4, 1, false)).toEqual([4, 1, 2, 3]);
    expect(placeNextTo(ids, 2, 2, true)).toEqual(ids);
    expect(sameOrder(ids, [1, 2, 3, 4])).toBe(true);
    expect(sameOrder(ids, [1, 2, 4, 3])).toBe(false);
  });
});
