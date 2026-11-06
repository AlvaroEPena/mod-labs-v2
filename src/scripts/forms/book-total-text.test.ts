import { describe, expect, it } from "vitest";
import { totalText } from "./book-total-text";

describe("totalText", () => {
  it("prompts when nothing is selected", () => {
    expect(totalText([])).toBe("Nothing selected yet.");
  });
  it("sums the selected prices and says it's an estimate", () => {
    expect(totalText([160])).toBe("1 mod selected, $160 estimated. I confirm the final price before any work.");
    expect(totalText([160, 120])).toMatch(/^2 mods selected, \$280 estimated\./);
  });
});
