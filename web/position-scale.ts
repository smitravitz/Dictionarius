/**
 * Where each position sits on the position slider: how many letters come
 * before the match, laid out across the active scrubber range (the middle
 * 80% of the screen; 0 = its left end, 1 = its right end).
 *
 * The bars aren't equal. Most people want 0 to 8 letters before, so those get
 * the room: 0-3 a little, 4-6 the most, and 6 lands at about 75%, where a
 * right thumb rests. 0-7 fill 82%. Positions 8 and up are a compressed tail,
 * each bar narrower than the last, squeezed into the final 18% when there are
 * too many; sliding through it is quick, as it should be for rare positions.
 * A list with few positions keeps the same widths and sits centred, so a bar
 * is never wider than in the full layout.
 */

/** Widths of positions 0-7, as shares of the range. */
const MAIN = [0.08, 0.08, 0.09, 0.11, 0.125, 0.13, 0.145, 0.06];
/** Width of position n >= 8 before squeezing: 6%, 4%, 3%, 2.4%, … */
const tailWidth = (n: number) => 0.12 / (n - 6);

export interface PositionScale {
  /** Where each position starts, as a share of the range, plus where the
   *  last one ends: positions + 1 numbers, ascending. */
  edges: number[];
  /** The position at share `x` of the range. Left of the bars is the first
   *  position, right of them the last. */
  at(x: number): number;
}

export function positionScale(positions: number): PositionScale {
  const widths = Array.from({ length: positions }, (_, n) => (n < MAIN.length ? MAIN[n] : tailWidth(n)));
  const head = widths.slice(0, MAIN.length).reduce((a, b) => a + b, 0);
  const tail = widths.slice(MAIN.length).reduce((a, b) => a + b, 0);
  if (head + tail > 1) {
    const squeeze = (1 - head) / tail;
    for (let n = MAIN.length; n < positions; n++) widths[n] *= squeeze;
  }
  const total = Math.min(1, head + tail);
  const edges = [(1 - total) / 2];
  for (const w of widths) edges.push(edges[edges.length - 1] + w);
  if (positions > 0) edges[positions] = Math.min(edges[positions], 1);

  return {
    edges,
    at(x: number) {
      let n = 0;
      while (n < positions - 1 && x >= edges[n + 1]) n++;
      return n;
    },
  };
}

const MAX_DOTS = 10;

/** The slider's label for a position: a dot per letter before the match, up
 *  to ten; past ten, the ten dots then "10+1", "10+2", … */
export function positionDots(value: number): { dots: string; more: string } {
  return {
    dots: "•".repeat(Math.min(value, MAX_DOTS)),
    more: value > MAX_DOTS ? `${MAX_DOTS}+${value - MAX_DOTS}` : "",
  };
}
