import { describe, it, expect } from "vitest";
import { CONTROLS, ShuffleBag, TOUR, Tour } from "../web/guide";

// The first-run tour: four things to do, in order, each shown and then asked for, once.
// And How It Works, the help sheet behind the "?".

describe("How It Works", () => {
  it("lists the five controls, in the owner's words", () => {
    expect(CONTROLS.map((c) => [c.how, c.does])).toEqual([
      ["Tap a piece at the bottom of the start screen", "to search for it and open its word list"],
      ["Tap a word", "for its dictionary result page"],
      ["Hold a word", "to peek at what it means"],
      ["Press & Hold beside a word to see the frequency graph", "then drag Left or Right to move where the piece goes"],
      ["Back", "returns to the word list, where you left it"],
    ]);
  });
});

describe("the tour", () => {
  it("asks for four things, in this order, in these words", () => {
    expect(TOUR.map((s) => [s.event, s.screen, `${s.how} ${s.does}`])).toEqual([
      ["searched", "start", "Tap a piece below to search for it and open every word with it inside:"],
      ["scrubbed", "results", "Press & Hold beside a word, then drag Left or Right to move where the piece goes:"],
      ["peeked", "results", "Press & Hold a word to peek at what it means:"],
      ["filtered", "results", "Tap the funnel to choose how long the words can be:"],
    ]);
  });

  it("starts at searching, on a first run", () => {
    const tour = new Tour(null);
    expect(tour.active).toBe(true);
    expect(tour.current?.event).toBe("searched");
    expect(tour.number).toBe(1);
  });

  it("moves on only when the step asked for is done", () => {
    const tour = new Tour(null);
    expect(tour.done("peeked")).toBe(false); // ahead of its turn: not counted
    expect(tour.done("scrubbed")).toBe(false);
    expect(tour.current?.event).toBe("searched");
    expect(tour.done("searched")).toBe(true);
    expect(tour.current?.event).toBe("scrubbed");
    expect(tour.number).toBe(2);
    expect(tour.done("peeked")).toBe(false); // still not its turn
    expect(tour.done("scrubbed")).toBe(true);
    expect(tour.done("peeked")).toBe(true);
    expect(tour.number).toBe(4);
    expect(tour.finished).toBe(false);
    expect(tour.done("filtered")).toBe(true);
    expect(tour.finished).toBe(true);
    expect(tour.current).toBeNull();
    expect(tour.stored()).toBe("done");
  });

  it("ignores what's already done", () => {
    const tour = new Tour(null);
    tour.done("searched");
    expect(tour.done("searched")).toBe(false);
    expect(tour.number).toBe(2);
  });

  it("stays finished on later runs, and once skipped", () => {
    expect(new Tour("done").active).toBe(false);
    expect(new Tour("done").current).toBeNull();
    const tour = new Tour(null);
    tour.skip();
    expect(tour.active).toBe(false);
    expect(tour.done("searched")).toBe(false);
    expect(tour.stored()).toBe("done");
  });

  it("starts again from the first step when asked", () => {
    const tour = new Tour(null);
    tour.done("searched");
    tour.skip();
    tour.restart();
    expect(tour.active).toBe(true);
    expect(tour.current?.event).toBe("searched");
    expect(tour.number).toBe(1);
    expect(tour.stored()).toBeNull();
  });
});

/** A repeatable stand-in for Math.random. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

describe("the shuffle bag (which word the peek step lights next)", () => {
  const words = ["a", "b", "c", "d", "e", "f", "g"];

  it("gives every word on offer a turn before any comes round again", () => {
    const bag = new ShuffleBag<string>(seeded(7));
    for (let round = 0; round < 5; round++) {
      const picks = words.map(() => bag.next(words));
      expect([...picks].sort()).toEqual(words); // each once: no repeats within a round
    }
  });

  it("never lights the same word twice running, even from one round to the next", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const bag = new ShuffleBag<string>(seeded(seed));
      let last: string | null = null;
      for (let i = 0; i < 60; i++) {
        const pick = bag.next(words);
        expect(pick).not.toBe(last);
        last = pick;
      }
    }
  });

  it("goes in no particular order", () => {
    const orders = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const bag = new ShuffleBag<string>(seeded(seed));
      orders.add(words.map(() => bag.next(words)).join(""));
    }
    expect(orders.size).toBeGreaterThan(15); // not the same order each time
    expect(orders.has(words.join(""))).toBe(false); // nor top to bottom
  });

  it("picks only from what's on offer now (the list scrolled), the unlit first", () => {
    const bag = new ShuffleBag<string>(seeded(3));
    const first = [bag.next(["a", "b", "c"]), bag.next(["a", "b", "c"])];
    // Scrolled: c, d and e are on screen now. Whichever of a, b, c is unlit, and d, e, go first.
    const unlit = ["a", "b", "c"].filter((w) => !first.includes(w)).filter((w) => ["c", "d", "e"].includes(w));
    const next = [bag.next(["c", "d", "e"]), bag.next(["c", "d", "e"])];
    for (const pick of next) expect(["d", "e", ...unlit]).toContain(pick);
  });

  it("copes with one word on offer, and with none", () => {
    const bag = new ShuffleBag<string>(seeded(5));
    expect(bag.next([])).toBeNull();
    expect(bag.next(["only"])).toBe("only");
    expect(bag.next(["only"])).toBe("only"); // nothing else to light
  });
});
