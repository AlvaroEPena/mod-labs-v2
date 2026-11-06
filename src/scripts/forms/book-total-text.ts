/** Pure wording for the /book selection readout (unit-tested). */
export function totalText(prices: readonly number[]): string {
  if (!prices.length) return "Nothing selected yet.";
  const sum = prices.reduce((a, b) => a + b, 0);
  const what = prices.length === 1 ? "1 mod selected" : `${prices.length} mods selected`;
  return `${what}, $${sum} estimated. I confirm the final price before any work.`;
}
