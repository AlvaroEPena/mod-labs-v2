import { describe, expect, it } from "vitest";
import { matchesQuery, normalize, resultText } from "./faq-match";

describe("matchesQuery", () => {
  const faq = "Do you do mail-in? Yes. Send a request, pick Mail-in, and we'll work out shipping.";

  it("matches every word, ignoring case and punctuation", () => {
    expect(matchesQuery("MAIL in", faq)).toBe(true);
    expect(matchesQuery("shipping request", faq)).toBe(true);
    expect(matchesQuery("shipping warranty", faq)).toBe(false);
  });

  it("ignores accents and treats an empty query as a match", () => {
    expect(normalize("Ávila Café")).toBe("avila cafe");
    expect(matchesQuery("", faq)).toBe(true);
    expect(matchesQuery("   ", faq)).toBe(true);
  });
});

describe("resultText", () => {
  it("words the count for the live region", () => {
    expect(resultText(9, 9, false)).toBe("All 9 questions");
    expect(resultText(3, 9, true)).toBe("3 of 9 questions match");
    expect(resultText(1, 9, true)).toBe("1 of 9 questions matches");
    expect(resultText(0, 9, true)).toBe("No questions match");
  });
});
