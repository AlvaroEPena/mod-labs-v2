import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryReviewStore } from "./memory-store";
import { NOW, SIGNING_KEY } from "./testing";
import {
  consumeVisitorAllowance,
  MAX_REVIEWS_PER_VISITOR_PER_DAY,
  UNKNOWN_VISITOR_BUCKET,
  utcDay,
  visitorBucketKey,
} from "./visitor-limit";

afterEach(() => vi.restoreAllMocks());

/** The spec §18 formula, computed independently with node:crypto. */
const expectedKey = (secret: string, day: string, bucket: string) => {
  const dayKey = createHmac("sha256", secret).update(`review-limit:${day}`).digest();
  return createHmac("sha256", dayKey).update(bucket).digest("hex");
};

describe("utcDay", () => {
  it("names the UTC day, whatever the time of day", () => {
    expect(utcDay(Date.UTC(2026, 10, 5, 0, 0))).toBe("2026-11-05");
    expect(utcDay(Date.UTC(2026, 10, 5, 23, 59, 59, 999))).toBe("2026-11-05");
    expect(utcDay(Date.UTC(2026, 10, 6))).toBe("2026-11-06");
  });
});

describe("visitorBucketKey", () => {
  it("is HMAC(HMAC(signing key, 'review-limit:' + day), bucket), in hex", async () => {
    const key = await visitorBucketKey(SIGNING_KEY, "2026-11-05", "v4:192.0.2.10");
    expect(key).toBe(expectedKey(SIGNING_KEY, "2026-11-05", "v4:192.0.2.10"));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("192");
  });

  it("changes with the day, the bucket and the signing key", async () => {
    const base = await visitorBucketKey(SIGNING_KEY, "2026-11-05", "v4:192.0.2.10");
    expect(await visitorBucketKey(SIGNING_KEY, "2026-11-06", "v4:192.0.2.10")).not.toBe(base);
    expect(await visitorBucketKey(SIGNING_KEY, "2026-11-05", "v4:192.0.2.11")).not.toBe(base);
    expect(await visitorBucketKey(`${SIGNING_KEY}x`, "2026-11-05", "v4:192.0.2.10")).not.toBe(base);
    expect(await visitorBucketKey(SIGNING_KEY, "2026-11-05", "v4:192.0.2.10")).toBe(base);
  });
});

describe("consumeVisitorAllowance", () => {
  const deps = (store: MemoryReviewStore, pending: Promise<unknown>[] = []) => ({
    store,
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
  });

  it(`allows ${MAX_REVIEWS_PER_VISITOR_PER_DAY} per day and bucket, then refuses`, async () => {
    const store = new MemoryReviewStore();
    const results: boolean[] = [];
    for (let i = 0; i <= MAX_REVIEWS_PER_VISITOR_PER_DAY; i++) {
      results.push(await consumeVisitorAllowance(deps(store), SIGNING_KEY, "192.0.2.10", NOW));
    }
    expect(results).toEqual([true, true, true, false]);
    expect(await consumeVisitorAllowance(deps(store), SIGNING_KEY, "192.0.2.10", NOW + 86_400_000)).toBe(
      true,
    );
  });

  it("uses the shared bucket for a missing or malformed address, and logs no address", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new MemoryReviewStore();
    await consumeVisitorAllowance(deps(store), SIGNING_KEY, null, NOW);
    await consumeVisitorAllowance(deps(store), SIGNING_KEY, "999.999.0.1", NOW);
    expect(store.visitorBuckets()).toEqual([
      { key: expectedKey(SIGNING_KEY, "2026-11-05", UNKNOWN_VISITOR_BUCKET), day: "2026-11-05", count: 2 },
    ]);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("999.999");
  });

  it("purges buckets from before yesterday off the response path, and survives a failing purge", async () => {
    const store = new MemoryReviewStore();
    await store.recordVisitorSubmission("two-days-ago", "2026-11-03");
    await store.recordVisitorSubmission("yesterday", "2026-11-04");
    const pending: Promise<unknown>[] = [];
    await consumeVisitorAllowance(deps(store, pending), SIGNING_KEY, "192.0.2.10", NOW);
    await Promise.all(pending);
    expect(
      store
        .visitorBuckets()
        .map((b) => b.day)
        .sort(),
    ).toEqual(["2026-11-04", "2026-11-05"]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(store, "purgeVisitorCountsBefore").mockRejectedValue(new Error("D1 busy"));
    const failing: Promise<unknown>[] = [];
    expect(await consumeVisitorAllowance(deps(store, failing), SIGNING_KEY, "192.0.2.10", NOW)).toBe(true);
    await expect(Promise.all(failing)).resolves.toBeDefined();
    expect(warn).toHaveBeenCalledWith("review limit purge failed", "Error");
  });
});
