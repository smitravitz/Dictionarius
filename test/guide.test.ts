import { describe, it, expect } from "vitest";
import { CONTROLS, TOUR, Tour } from "../web/guide";

// The first-run tour: three things to do (search, peek, scrub), in any order, once.

describe("the tour", () => {
  it("asks for at most three things, each a control the help sheet explains", () => {
    expect(TOUR.length).toBeLessThanOrEqual(3);
    const keys = CONTROLS.map((c) => c.key);
    for (const step of TOUR) expect(keys).toContain(step.control);
  });

  it("starts at searching, on a first run", () => {
    const tour = new Tour(null);
    expect(tour.active).toBe(true);
    expect(tour.current?.event).toBe("searched");
    expect(tour.number).toBe(1);
  });

  it("moves on as each is done, in any order, and finishes when all are", () => {
    const tour = new Tour(null);
    expect(tour.done("scrubbed")).toBe(true); // ahead of time: counted
    expect(tour.current?.event).toBe("searched"); // still the first not done
    tour.done("searched");
    expect(tour.current?.event).toBe("peeked");
    expect(tour.number).toBe(3); // two of three done: this is the last
    expect(tour.done("peeked")).toBe(true);
    expect(tour.finished).toBe(true);
    expect(tour.current).toBeNull();
    expect(tour.stored()).toBe("done");
  });

  it("ignores what's already done", () => {
    const tour = new Tour(null);
    tour.done("searched");
    expect(tour.done("searched")).toBe(false);
  });

  it("stays finished on later runs, and once skipped", () => {
    expect(new Tour("done").active).toBe(false);
    const tour = new Tour(null);
    tour.skip();
    expect(tour.active).toBe(false);
    expect(tour.stored()).toBe("done");
  });

  it("starts again when asked", () => {
    const tour = new Tour("done");
    tour.restart();
    expect(tour.active).toBe(true);
    expect(tour.current?.event).toBe("searched");
  });
});
