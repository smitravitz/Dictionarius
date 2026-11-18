/**
 * The position slider's spread bands: where the middle 68.3% and the middle
 * 95.4% of the words begin and end, so the person can see how a list is spread
 * while they scrub. They are drawn as dotted lines behind the bars.
 *
 * The lines mark shares of the words themselves, not the mean ± 1 and 2
 * standard deviations. Word counts by position are lopsided (most "pre" words
 * start with it), so mean ± 1 SD can hold anywhere from about half to nine
 * tenths of the words, and mean − 2 SD often falls before 0 letters. Marking
 * the shares directly keeps the labels true for every list (ADR-0011).
 *
 * Positions are continuous here: position n spans n to n + 1, its words spread
 * evenly across it, so a line can fall partway through a bar.
 */

/** The middle shares marked, as a bell curve's ±1 and ±2 standard deviations hold them. */
const INNER = 0.6827;
const OUTER = 0.9545;

export interface SpreadBands {
  /** The four lines, left to right, in positions: where the middle 95.4% begins, the
   *  middle 68.3% begins, the middle 68.3% ends and the middle 95.4% ends. */
  lines: [number, number, number, number];
  /** The share of the words between each pair of neighbouring lines, left to right. */
  labels: [string, string, string];
}

/** The bands for a list's words per position, or null when it has no words. */
export function spreadBands(byOffset: readonly number[]): SpreadBands | null {
  const total = byOffset.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;

  // The point where the given share of the words has been passed, left to right.
  const reach = (share: number) => {
    const target = share * total;
    let passed = 0;
    for (let n = 0; n < byOffset.length; n++) {
      const count = byOffset[n];
      if (passed + count >= target) return n + (target - passed) / count;
      passed += count;
    }
    return byOffset.length;
  };

  const outerTail = (1 - OUTER) / 2;
  const innerTail = (1 - INNER) / 2;
  const side = percent((OUTER - INNER) / 2);
  return {
    lines: [reach(outerTail), reach(innerTail), reach(1 - innerTail), reach(1 - outerTail)],
    labels: [side, percent(INNER), side],
  };
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}
