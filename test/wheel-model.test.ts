import { describe, it, expect } from "vitest";
import { chooseMax, chooseMin, landing, maxOptions, minOptions } from "../web/wheel-model";

// A range filter is set with two roller wheels, Min and Max. Each starts on
// "Any" (null), then counts up. The Max wheel starts from the chosen minimum,
// and choosing a minimum puts Max back on Any. A vertical drag turns a wheel;
// a flick carries on a little; it always lands on a whole row.

describe("the wheels' options", () => {
  it("offers Any, then every value up to the largest", () => {
    expect(minOptions(1, 6)).toEqual([null, 1, 2, 3, 4, 5, 6]);
    expect(maxOptions(null, 1, 6)).toEqual([null, 1, 2, 3, 4, 5, 6]);
  });

  it("starts the Max wheel from the chosen minimum", () => {
    expect(maxOptions(4, 1, 6)).toEqual([null, 4, 5, 6]);
    expect(maxOptions(6, 1, 6)).toEqual([null, 6]);
  });
});

describe("choosing", () => {
  it("puts Max back on Any when the minimum changes", () => {
    expect(chooseMin([2, 9], 4)).toEqual([4, null]);
    expect(chooseMin([4, 9], null)).toEqual([null, null]);
  });

  it("keeps the minimum when Max changes", () => {
    expect(chooseMax([4, null], 7)).toEqual([4, 7]);
    expect(chooseMax([null, 7], null)).toEqual([null, null]);
  });
});

describe("where a wheel lands", () => {
  const ROW = 40; // px per row

  it("turns by whole rows: dragging up brings the next value to the middle", () => {
    expect(landing(0, 0, 0, ROW, 10)).toBe(0);
    expect(landing(0, -95, 0, ROW, 10)).toBe(2); // 2.4 rows up
    expect(landing(5, 61, 0, ROW, 10)).toBe(3); // 1.5 rows down rounds away from the start
    expect(landing(5, 19, 0, ROW, 10)).toBe(5); // less than half a row: stays
  });

  it("stops at either end", () => {
    expect(landing(1, 500, 0, ROW, 10)).toBe(0);
    expect(landing(8, -500, 0, ROW, 10)).toBe(9);
  });

  it("carries on after a flick, further the faster it was", () => {
    const slow = landing(0, -40, -0.5, ROW, 30);
    const fast = landing(0, -40, -2, ROW, 30);
    expect(slow).toBeGreaterThan(1);
    expect(fast).toBeGreaterThan(slow);
    expect(landing(0, -40, 0.01, ROW, 30)).toBe(1); // a slow release doesn't carry
  });
});
