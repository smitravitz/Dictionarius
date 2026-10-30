import { describe, it, expect } from "vitest";
import { EXAMPLES, PER_ROW, exampleLabel, tileWeight } from "../web/examples";

// The start screen's bag of pieces.

describe("the bag of pieces", () => {
  it("fills its rows exactly, each piece once", () => {
    expect(EXAMPLES.length % PER_ROW).toBe(0);
    const labels = EXAMPLES.map(([fragment, where]) => exampleLabel(fragment, where));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("weighs a piece by its word count, on a log scale from the fewest (0) to the most (1)", () => {
    const counts = [100, 1000, 10000];
    expect(tileWeight(100, counts)).toBe(0);
    expect(tileWeight(10000, counts)).toBe(1);
    expect(tileWeight(1000, counts)).toBeCloseTo(0.5);
    expect(tileWeight(5, [5, 5])).toBe(0.5); // all alike: the middle size
  });
});
