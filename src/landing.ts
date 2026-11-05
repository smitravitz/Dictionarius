/**
 * Where a suggestion's results open. Its first words are rarely the
 * interesting ones (the piece itself, odd names starting with it), so the list
 * opens around its middle instead: at a word anywhere from 43% to 57% of the
 * way down, both ends included, chosen at random so the same suggestion
 * shows something new each time. The list stays whole: scroll up for the
 * words that start with the piece.
 */

/** How far either side of the middle a landing may fall, as a share of the list. */
export const LANDING_SPREAD = 0.07;

/** The row to open a list of `total` words at, or null for an empty list. */
export function landingRow(total: number, random: () => number = Math.random): number | null {
  if (total <= 0) return null;
  const last = total - 1;
  const lo = Math.round(last * (0.5 - LANDING_SPREAD));
  const hi = Math.round(last * (0.5 + LANDING_SPREAD));
  return lo + Math.min(hi - lo, Math.floor(random() * (hi - lo + 1)));
}
