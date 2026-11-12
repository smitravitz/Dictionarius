import { describe, expect, it } from "vitest";
import { connectionQuality } from "../web/connection";

// How good the connection is, judged from the dictionary's own download (bytes in by time):
// nothing is sent anywhere to measure it. Worked examples, by hand.

/** Bytes in at a steady `perSecond`, a sample every 250 ms (as the data worker tells it), for `ms`. */
const steady = (perSecond: number, ms: number, from = { at: 0, bytes: 0 }) =>
  Array.from({ length: ms / 250 + 1 }, (_, i) => ({ at: from.at + i * 250, bytes: from.bytes + (perSecond * i) / 4 }));

describe("connection quality, from the download's own speed", () => {
  it("2 MB a second is a fast connection", () => {
    expect(connectionQuality(steady(2_000_000, 3000), 3000, true)).toBe("fast");
  });

  it("300 kB a second is a slow one", () => {
    expect(connectionQuality(steady(300_000, 3000), 3000, true)).toBe("slow");
  });

  it("50 kB a second is very slow", () => {
    expect(connectionQuality(steady(50_000, 3000), 3000, true)).toBe("very slow");
  });

  it("the edges: 1 MB a second is fast, 100 kB a second is slow", () => {
    expect(connectionQuality(steady(1_000_000, 2000), 2000, true)).toBe("fast");
    expect(connectionQuality(steady(100_000, 2000), 2000, true)).toBe("slow");
  });

  it("judges by the last 5 seconds: a fast start, then a slow stretch, is slow now", () => {
    const fast = steady(2_000_000, 4000);
    const slow = steady(200_000, 6000, fast.at(-1)!).slice(1);
    expect(connectionQuality([...fast, ...slow], 10_000, true)).toBe("slow");
  });

  it("nothing in for 8 seconds is no connection", () => {
    const samples = steady(500_000, 2000);
    expect(connectionQuality(samples, 2000 + 7999, true)).toBe("slow");
    expect(connectionQuality(samples, 2000 + 8000, true)).toBe("none");
  });

  it("the browser saying it's offline is no connection, at once", () => {
    expect(connectionQuality(steady(2_000_000, 3000), 3000, false)).toBe("none");
  });

  it("says nothing before it has a second to judge by", () => {
    expect(connectionQuality([], 0, true)).toBeNull();
    expect(connectionQuality(steady(2_000_000, 750), 750, true)).toBeNull();
  });
});
