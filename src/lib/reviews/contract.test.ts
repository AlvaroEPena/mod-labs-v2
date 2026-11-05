import { describe, expect, it } from "vitest";
import { renderReviewItem, reviewDate, reviewFormToObject, reviewSchema, sourceLabel, summarize, summaryText, type PublicReview } from "./contract";

const valid = { name: "Jordan M.", rating: "5", service: "Switch OLED", source: "Facebook", body: "Dropped off my OLED in the morning and it was done by dinner.", consent: "yes", hp: "" };

describe("reviewSchema", () => {
  it("accepts a normal review and coerces the rating", () => {
    const r = reviewSchema.safeParse(valid);
    expect(r.success).toBe(true);
    expect(r.success && r.data.rating).toBe(5);
  });

  it.each([
    ["links", { body: "Great work, also check out https://spam.example for deals!" }],
    ["bare domains", { body: "Great work, visit cheapmods.xyz for more great deals today" }],
    ["markup-ish names", { name: "<script>" }],
    ["ratings out of range", { rating: "6" }],
    ["non-integer ratings", { rating: "4.5" }],
    ["unknown services", { service: "Toaster" }],
    ["unknown sources", { source: "Myspace" }],
    ["short reviews", { body: "Good." }],
    ["missing consent", { consent: "" }],
    ["a filled honeypot", { hp: "bot" }],
  ])("rejects %s", (_label, patch) => {
    expect(reviewSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it("allows an empty service/source and accented names", () => {
    expect(reviewSchema.safeParse({ ...valid, service: "", source: "", name: "José O'Neil-Ávila" }).success).toBe(true);
  });

  it("reads multipart form data", () => {
    const fd = new FormData();
    Object.entries({ ...valid, hp_7f3: "" }).forEach(([k, v]) => fd.append(k, v));
    expect(reviewSchema.safeParse(reviewFormToObject(fd)).success).toBe(true);
  });
});

describe("renderReviewItem", () => {
  const review: PublicReview = { id: 1, name: "Sam", rating: 4, service: "Repair", source: "Google", body: "Fixed my joystick drift.", approvedAt: Date.UTC(2026, 10, 3) };

  it("escapes every user-supplied string", () => {
    const html = renderReviewItem({ ...review, name: `<img src=x onerror=alert(1)>`, body: `"><script>alert(1)</script>`, service: `<b>x</b>` });
    expect(html).not.toMatch(/<script|<img|<b>/);
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders stars, name, service and month", () => {
    const html = renderReviewItem(review);
    expect(html.match(/class="star is-on"/g)).toHaveLength(4);
    expect(html).toContain('aria-label="Rated 4 out of 5"');
    expect(html).toContain("Repair · Nov 2026");
  });

  it("shows where they heard about Mod Labs as subtext, and nothing for Other/none", () => {
    expect(renderReviewItem(review)).toContain('<span class="review-source">Found us on Google</span>');
    expect(renderReviewItem({ ...review, source: "A friend" })).toContain("Referred by a friend");
    expect(renderReviewItem({ ...review, source: "Other" })).not.toContain("review-source");
    expect(renderReviewItem({ ...review, source: null })).not.toContain("review-source");
    expect(sourceLabel("<b>")).toBe("");
  });

  it("keeps paragraph breaks without allowing markup", () => {
    expect(renderReviewItem({ ...review, body: "One.\n\nTwo\nthree" })).toContain("<p>One.</p><p>Two<br>three</p>");
  });
});

describe("summaries", () => {
  it("averages to one decimal and words the count", () => {
    expect(summaryText(summarize([{ rating: 5 }, { rating: 4 }, { rating: 5 }]))).toBe("4.7 average from 3 reviews");
    expect(summaryText(summarize([{ rating: 5 }]))).toBe("5.0 average from 1 review");
    expect(summaryText(summarize([]))).toBe("");
  });
  it("formats dates in UTC", () => {
    expect(reviewDate(Date.UTC(2026, 0, 31, 23, 59))).toBe("Jan 2026");
  });
});
