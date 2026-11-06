import { describe, expect, it } from "vitest";
import { RATING_PROMPT, ratingText, starLabel } from "./rating";

describe("ratingText", () => {
  it("words a 1-5 rating", () => {
    expect(ratingText(1)).toBe("1 out of 5: Poor");
    expect(ratingText(5)).toBe("5 out of 5: Excellent");
  });
  it("falls back to the prompt for no or invalid values", () => {
    expect(ratingText(0)).toBe(RATING_PROMPT);
    expect(ratingText(6)).toBe(RATING_PROMPT);
    expect(ratingText(2.5)).toBe(RATING_PROMPT);
    expect(ratingText(Number.NaN)).toBe(RATING_PROMPT);
  });
});

describe("starLabel", () => {
  it("names each radio with its count and word", () => {
    expect(starLabel(1)).toBe("1 star: Poor");
    expect(starLabel(4)).toBe("4 stars: Great");
  });
});
