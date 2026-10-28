/**
 * The rules behind a range filter's two roller wheels (web/wheel.ts draws
 * them). Each wheel starts on "Any" (null), then counts up. The Max wheel
 * starts from the chosen minimum, and choosing a minimum puts Max back on Any.
 * A vertical drag turns a wheel by whole rows; a flick carries it on a little.
 */
import type { Range } from "../src/filters";

/** How far a flick carries on: its speed (px/ms) times this. */
const CARRY_MS = 150;
/** Slower releases than this (px/ms) don't carry on. */
const CARRY_FROM = 0.05;

/** The Min wheel: Any, then `lowest` up to `highest`. */
export function minOptions(lowest: number, highest: number): (number | null)[] {
  return [null, ...count(lowest, highest)];
}

/** The Max wheel: Any, then from the chosen minimum (or `lowest`) up to `highest`. */
export function maxOptions(min: number | null, lowest: number, highest: number): (number | null)[] {
  return [null, ...count(Math.max(min ?? lowest, lowest), highest)];
}

/** A new minimum; Max goes back to Any. */
export function chooseMin(_range: Range, min: number | null): Range {
  return [min, null];
}

/** A new maximum; the minimum stays. */
export function chooseMax(range: Range, max: number | null): Range {
  return [range[0], max];
}

/**
 * The row a wheel lands on: it was on row `from`, the finger moved `dy` px
 * (negative is up, which brings later rows to the middle) and let go at
 * `velocity` px/ms. Whole rows only, within [0, rows).
 */
export function landing(from: number, dy: number, velocity: number, rowHeight: number, rows: number): number {
  const carry = Math.abs(velocity) < CARRY_FROM ? 0 : velocity * CARRY_MS;
  const row = from - Math.round((dy + carry) / rowHeight);
  return Math.min(rows - 1, Math.max(0, row));
}

function count(from: number, to: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to; v++) out.push(v);
  return out;
}
