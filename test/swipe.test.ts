import { describe, it, expect } from "vitest";
import { swipeOf } from "../web/swipe";

// A quick sideways flick of a finger: rightward steps back, leftward steps
// forward. Slower than a hold, mostly up and down, too short, or spent
// scrolling a row sideways, it isn't one.

const stroke = (dx: number, dy: number, ms: number) => ({ x0: 200, y0: 400, t0: 1000, x1: 200 + dx, y1: 400 + dy, t1: 1000 + ms });

describe("swipeOf", () => {
  it("reads a quick flick rightward as back, leftward as forward", () => {
    expect(swipeOf(stroke(120, 10, 180))).toBe("back");
    expect(swipeOf(stroke(-120, -10, 180))).toBe("forward");
  });

  it("ignores a stroke that's too short, too slow (a hold) or mostly vertical", () => {
    expect(swipeOf(stroke(40, 0, 100))).toBeNull();
    expect(swipeOf(stroke(150, 0, 450))).toBeNull(); // held long enough to be a hold first
    expect(swipeOf(stroke(120, 80, 180))).toBeNull();
  });

  it("ignores a stroke that scrolled a row sideways", () => {
    expect(swipeOf(stroke(-120, 0, 180), { scrolled: true })).toBeNull();
  });
});
