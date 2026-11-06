import { describe, expect, it } from "vitest";
import { nextIndex } from "./tabs-keys";

describe("nextIndex (tabs keyboard model)", () => {
  it("moves with Left/Right and wraps at both ends", () => {
    expect(nextIndex("ArrowRight", 0, 3, true)).toBe(1);
    expect(nextIndex("ArrowRight", 2, 3, true)).toBe(0);
    expect(nextIndex("ArrowLeft", 0, 3, true)).toBe(2);
  });

  it("jumps to the ends with Home/End", () => {
    expect(nextIndex("Home", 2, 3, true)).toBe(0);
    expect(nextIndex("End", 0, 3, true)).toBe(2);
  });

  it("only answers Up/Down when the tablist isn't horizontal-only", () => {
    expect(nextIndex("ArrowDown", 0, 9, true)).toBeNull();
    expect(nextIndex("ArrowDown", 0, 9, false)).toBe(1);
    expect(nextIndex("ArrowUp", 0, 9, false)).toBe(8);
  });

  it("ignores other keys and empty lists, and treats 'nothing selected yet' as the first tab", () => {
    expect(nextIndex("Enter", 0, 3, true)).toBeNull();
    expect(nextIndex("ArrowRight", 0, 0, true)).toBeNull();
    expect(nextIndex("ArrowRight", -1, 3, true)).toBe(1);
  });
});
