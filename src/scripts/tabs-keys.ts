/**
 * Keyboard model for tabs (pure, unit-tested): arrows wrap around, Home/End jump to the ends.
 * Up/Down also move unless the tablist is horizontal-only (a grid of tabs answers to all four arrows).
 * Returns the index to select, or null when the key isn't a tabs key.
 */
export function nextIndex(key: string, current: number, count: number, horizontalOnly: boolean): number | null {
  if (count <= 0) return null;
  const from = Math.max(0, current);
  switch (key) {
    case "ArrowRight":
      return (from + 1) % count;
    case "ArrowLeft":
      return (from - 1 + count) % count;
    case "ArrowDown":
      return horizontalOnly ? null : (from + 1) % count;
    case "ArrowUp":
      return horizontalOnly ? null : (from - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
