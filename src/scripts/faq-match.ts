/**
 * FAQ filter matching (pure, unit-tested). Case- and accent-insensitive; every word of the query must
 * appear somewhere in the question or answer, so "mail in" finds "Do you do mail-in?".
 */
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function matchesQuery(query: string, text: string): boolean {
  const words = normalize(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const haystack = ` ${normalize(text)} `;
  return words.every((w) => haystack.includes(w));
}

/** "All 9 questions" / "3 of 9 questions match" / "No questions match" */
export function resultText(shown: number, total: number, hasQuery: boolean): string {
  if (!hasQuery) return `All ${total} questions`;
  if (shown === 0) return "No questions match";
  return `${shown} of ${total} question${total === 1 ? "" : "s"} match${shown === 1 ? "es" : ""}`;
}
