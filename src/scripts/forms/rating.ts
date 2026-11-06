/** Star rating words (pure; shared by the StarRating component's labels and its live readout). */
export const RATING_WORDS = ["Poor", "Fair", "Good", "Great", "Excellent"] as const;
export const RATING_PROMPT = "Tap a star to rate";

/** 4 → "4 out of 5: Great"; anything outside 1-5 → the prompt */
export function ratingText(value: number): string {
  const word = RATING_WORDS[value - 1];
  return Number.isInteger(value) && word ? `${value} out of 5: ${word}` : RATING_PROMPT;
}

/** accessible name of one star radio: "1 star: Poor", "4 stars: Great" */
export const starLabel = (value: number) => `${value} star${value === 1 ? "" : "s"}: ${RATING_WORDS[value - 1]}`;
