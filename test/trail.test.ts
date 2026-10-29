import { describe, it, expect } from "vitest";
import { Trail } from "../src/trail";

// The words followed since leaving the results, as on a browser's history:
// open a word from the results, follow its links, step back and forward
// through them; Back from anywhere goes straight to the results, and a step
// forward from there takes up the same words again.

describe("Trail", () => {
  it("starts at the results, with nowhere to step", () => {
    const trail = new Trail<string>();
    expect(trail.here).toBeNull();
    expect([trail.canBack, trail.canForward]).toEqual([false, false]);
    expect(trail.back()).toBeNull();
    expect(trail.forward()).toBeNull();
  });

  it("steps back through the words followed, to the results, and forward again", () => {
    const trail = new Trail<string>();
    trail.start("zorbles");
    trail.follow("zorble");
    trail.follow("wobble");
    expect(trail.here).toBe("wobble");
    expect(trail.back()).toBe("zorble");
    expect(trail.back()).toBe("zorbles");
    expect(trail.back()).toBeNull(); // the results
    expect(trail.canBack).toBe(false);
    expect(trail.forward()).toBe("zorbles");
    expect(trail.forward()).toBe("zorble");
    expect(trail.forward()).toBe("wobble");
    expect(trail.canForward).toBe(false);
    expect(trail.forward()).toBeNull(); // nothing further: stays put
    expect(trail.here).toBe("wobble");
  });

  it("goes home to the results in one go, keeping the words for a step forward", () => {
    const trail = new Trail<string>();
    trail.start("zorbles");
    trail.follow("zorble");
    trail.follow("wobble");
    trail.home();
    expect(trail.here).toBeNull();
    expect(trail.canForward).toBe(true);
    expect(trail.forward()).toBe("zorbles");
    expect(trail.forward()).toBe("zorble");
  });

  it("following a link after stepping back drops the words ahead, as a browser does", () => {
    const trail = new Trail<string>();
    trail.start("zorbles");
    trail.follow("zorble");
    trail.follow("wobble");
    trail.back();
    trail.follow("make up");
    expect(trail.here).toBe("make up");
    expect(trail.canForward).toBe(false);
    expect(trail.back()).toBe("zorble");
  });

  it("opening a word from the results starts a new trail; clearing forgets it", () => {
    const trail = new Trail<string>();
    trail.start("zorbles");
    trail.follow("zorble");
    trail.home();
    trail.start("ingot");
    expect(trail.back()).toBeNull();
    expect(trail.forward()).toBe("ingot");
    expect(trail.canForward).toBe(false);
    trail.clear();
    expect([trail.here, trail.canBack, trail.canForward]).toEqual([null, false, false]);
  });

  it("knows how deep it is: 0 at the results", () => {
    const trail = new Trail<string>();
    expect(trail.depth).toBe(0);
    trail.start("zorbles");
    trail.follow("zorble");
    expect(trail.depth).toBe(2);
    trail.home();
    expect(trail.depth).toBe(0);
  });
});
