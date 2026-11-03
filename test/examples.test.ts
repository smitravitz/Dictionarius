import { describe, it, expect } from "vitest";
import { PIECES, lanesOf, tileWeight } from "../web/examples";

// The start screen's suggestions: plain pieces, shuffled into two lanes.

describe("the suggestions", () => {
  it("are plain pieces, each once", () => {
    const pieces = PIECES.map(([piece]) => piece);
    for (const p of pieces) expect(p).toMatch(/^[a-z]+$/);
    expect(new Set(pieces).size).toBe(pieces.length);
  });

  it("weigh a piece by its word count, on a log scale from the fewest (0) to the most (1)", () => {
    const counts = [100, 1000, 10000];
    expect(tileWeight(100, counts)).toBe(0);
    expect(tileWeight(10000, counts)).toBe(1);
    expect(tileWeight(1000, counts)).toBeCloseTo(0.5);
    expect(tileWeight(5, [5, 5])).toBe(0.5); // all alike: the middle size
  });
});

describe("lanesOf", () => {
  // A fixed sequence stands in for Math.random.
  const sequence = (...values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };

  it("deals every item once, the lanes within one of each other", () => {
    const lanes = lanesOf([1, 2, 3, 4, 5, 6, 7], 2, sequence(0.3, 0.8, 0.1));
    expect(lanes.map((l) => l.length)).toEqual([4, 3]);
    expect(lanes.flat().sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("shuffles: another start, another order", () => {
    const a = lanesOf(["a", "b", "c", "d", "e", "f"], 2, sequence(0.9, 0.2, 0.5, 0.7, 0.1));
    const b = lanesOf(["a", "b", "c", "d", "e", "f"], 2, sequence(0.1, 0.6, 0.3, 0.2, 0.9));
    expect(a).not.toEqual(b);
    expect(lanesOf(["a", "b", "c"], 2, () => 0.99999)).toEqual([["a", "c"], ["b"]]); // random() near 1: no swaps
  });
});
