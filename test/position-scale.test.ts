import { describe, it, expect } from "vitest";
import { positionDots, positionScale } from "../web/position-scale";

// The position slider's layout, as agreed: shares of the active scrubber range
// (the middle 80% of the screen). Positions 0-3 get 8, 8, 9 and 11%; 4-6 are
// the widest at 12.5, 13 and 14.5%, so 6 sits under a resting right thumb at
// about 75%; 7 gets 6%, so 0-7 fill 82%. Positions 8 and up are a compressed
// tail: 6, 4, 3, 2.4, … % (12 / (n - 6)), squeezed into the last 18% when
// there are too many. A short list keeps those widths and sits centred.

const widths = (positions: number) => {
  const { edges } = positionScale(positions);
  return edges.slice(1).map((end, i) => +((end - edges[i]) * 100).toFixed(2));
};

describe("positionScale", () => {
  it("gives 0-7 letters 82% of a long list's range, and squeezes the rest into the last 18%", () => {
    const { edges } = positionScale(26);
    expect(edges[0]).toBe(0);
    expect(edges[8]).toBeCloseTo(0.82, 6);
    expect(edges[26]).toBeCloseTo(1, 6);
    expect(widths(26).slice(0, 8)).toEqual([8, 8, 9, 11, 12.5, 13, 14.5, 6]);
  });

  it("puts 6 letters at 75% of the range, under a resting right thumb", () => {
    const scale = positionScale(26);
    expect(scale.at(0.75)).toBe(6);
    expect(scale.edges[6]).toBeCloseTo(0.615, 6);
    expect(scale.edges[7]).toBeCloseTo(0.76, 6);
  });

  it("draws the tail compressed: every bar past 7 narrower than the one before", () => {
    const tail = widths(26).slice(8);
    expect(tail.length).toBe(18);
    tail.forEach((w, i) => i > 0 && expect(w).toBeLessThan(tail[i - 1]));
    expect(Math.max(...tail)).toBeLessThan(6);
  });

  it("reaches the first and last position at and beyond the ends", () => {
    const scale = positionScale(26);
    expect(scale.at(0)).toBe(0);
    expect(scale.at(-0.2)).toBe(0);
    expect(scale.at(1)).toBe(25);
    expect(scale.at(1.3)).toBe(25);
    expect(scale.at(0.5)).toBe(5); // inside 5's 48.5-61.5%
  });

  it("keeps the same widths for a short list, centred", () => {
    const { edges } = positionScale(4); // 8 + 8 + 9 + 11 = 36% of the range
    expect(edges.map((e) => +e.toFixed(4))).toEqual([0.32, 0.4, 0.48, 0.57, 0.68]);
    expect(positionScale(4).at(0.1)).toBe(0); // left of the bars: the first
    expect(positionScale(4).at(0.9)).toBe(3); // right of them: the last
  });

  it("lets a tail that fits keep its natural widths", () => {
    // 82% + 6 + 4 + 3 = 95%: nothing to squeeze, centred, 6 still covers 75%.
    expect(widths(11).slice(8)).toEqual([6, 4, 3]);
    expect(positionScale(11).edges[0]).toBeCloseTo(0.025, 6);
    expect(positionScale(11).at(0.75)).toBe(6);
  });

  it("handles one position and none", () => {
    expect(positionScale(1).edges.map((e) => +e.toFixed(2))).toEqual([0.46, 0.54]);
    expect(positionScale(1).at(0.9)).toBe(0);
    expect(positionScale(0).edges).toEqual([0.5]);
    expect(positionScale(0).at(0.5)).toBe(0);
  });
});

describe("positionDots", () => {
  // The slider's label: a dot per letter before the match, up to ten; past
  // ten, the ten dots and then "10+1", "10+2", …
  it("writes a dot per letter up to ten, then 10+n after the ten dots", () => {
    const ten = "•".repeat(10);
    expect(positionDots(0)).toEqual({ dots: "", more: "" });
    expect(positionDots(3)).toEqual({ dots: "•••", more: "" });
    expect(positionDots(10)).toEqual({ dots: ten, more: "" });
    expect(positionDots(11)).toEqual({ dots: ten, more: "10+1" });
    expect(positionDots(23)).toEqual({ dots: ten, more: "10+13" });
  });
});
