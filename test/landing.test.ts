import { describe, it, expect } from "vitest";
import { landingRow } from "../src/landing";

// Where a suggestion's results open: a word around the middle of its list,
// anywhere from 43% to 57% of the way down (both ends included), at random,
// so the same suggestion shows something new each time.

describe("landingRow", () => {
  it("lands from 43% to 57% of the way down, both ends included", () => {
    expect(landingRow(101, () => 0)).toBe(43);
    expect(landingRow(101, () => 0.999999)).toBe(57);
    expect(landingRow(101, () => 0.5)).toBe(50);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(landingRow(101, () => i / 1000)!);
    expect(Math.min(...seen)).toBe(43);
    expect(Math.max(...seen)).toBe(57);
    expect(seen.size).toBe(15); // every row between: a spread, not one word
  });

  it("lands on the only word of a list of one, and nowhere in an empty one", () => {
    expect(landingRow(1, () => 0.7)).toBe(0);
    expect(landingRow(0, () => 0.7)).toBeNull();
  });
});
