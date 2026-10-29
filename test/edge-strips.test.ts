import { describe, it, expect } from "vitest";
import { edgeStrips } from "../web/edge-gestures";

// Where the phone's edge back gesture is turned off while the results show:
// a strip down each side of the list, centred on its lower half, where a
// thumb holds to reach the slider's ends. Android honours at most 200 dp per
// edge, so that's as tall as a strip gets.

describe("edgeStrips", () => {
  it("centres a 200 px strip on each side of the list's lower half", () => {
    // lower half: 520-860, centred on 690
    expect(edgeStrips({ top: 180, bottom: 860 }, 412)).toEqual([
      { x: 0, y: 590, width: 48, height: 200 },
      { x: 364, y: 590, width: 48, height: 200 },
    ]);
  });

  it("stays inside a short list, covering all of one under 200 px", () => {
    expect(edgeStrips({ top: 500, bottom: 640 }, 360)).toEqual([
      { x: 0, y: 500, width: 48, height: 140 },
      { x: 312, y: 500, width: 48, height: 140 },
    ]);
    // 300 px tall: lower half centred on 575 would end at 675, past the bottom
    expect(edgeStrips({ top: 350, bottom: 650 }, 360)[0]).toEqual({ x: 0, y: 450, width: 48, height: 200 });
  });

  it("is nothing when the list isn't showing", () => {
    expect(edgeStrips(null, 412)).toEqual([]);
    expect(edgeStrips({ top: 0, bottom: 0 }, 412)).toEqual([]);
  });
});
