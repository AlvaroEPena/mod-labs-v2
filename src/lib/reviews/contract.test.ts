import { describe, expect, it } from "vitest";
import { REVIEW_BODY_MAX, renderReviewItem, reviewDate, reviewFormToObject, reviewSchema, sourceLabel, summarize, summaryText, type PublicReview } from "./contract";

const publicReview: PublicReview = { id: 1, name: "Sam", rating: 5, service: null, source: null, body: "x", approvedAt: Date.UTC(2026, 10, 3) };
const valid ={ name: "Jordan M.", rating: "5", service: "Switch OLED", source: "Facebook", body: "Dropped off my OLED in the morning and it was done by dinner.", consent: "yes", hp: "" };

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

  it.each([
    ["a short-link domain", "Great install, message me on t.me/somebody for more"],
    ["a link shortener", "Really happy with it, details at bit.ly/xyz123 thanks"],
    ["a bare .co domain", "Best mods in town, also try evil.co for cheap parts"],
    ["an uppercase scheme", "Great work, see HTTPS://EXAMPLE.ORG for photos of it"],
  ])("rejects %s in the review", (_label, body) => {
    expect(reviewSchema.safeParse({ ...valid, body }).success).toBe(false);
  });

  it("rejects links and zalgo in names", () => {
    expect(reviewSchema.safeParse({ ...valid, name: "bit.ly" }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...valid, name: "Ja\u0301\u0301\u0301ne" }).success).toBe(false);
  });

  it("allows ordinary punctuation that only looks like a domain", () => {
    const body = "Dropped it off at 3.5 pm, e.g. before work. Done.Great job on the V1.V2 swap!";
    expect(reviewSchema.safeParse({ ...valid, body }).success).toBe(true);
  });

  it("normalizes CRLF newlines so length limits match the browser and paragraphs survive", () => {
    const body = `${"a".repeat(REVIEW_BODY_MAX - 3)}\r\n\r\nb`; // 802 chars as sent, 800 once CRLF -> LF
    const r = reviewSchema.safeParse({ ...valid, body });
    expect(r.success).toBe(true);
    expect(r.success && r.data.body).not.toContain("\r");
    const html = renderReviewItem({ ...publicReview, body: r.success ? r.data.body : "" });
    expect(html.match(/<p>/g)).toHaveLength(2);
  });

  it("strips invisible direction-override characters before checking", () => {
    const r = reviewSchema.safeParse({ ...valid, name: "Sam\u202E", body: `${valid.body}\u200B` });
    expect(r.success && r.data.name).toBe("Sam");
    expect(r.success && r.data.body).toBe(valid.body);
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
