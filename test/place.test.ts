import { describe, it, expect } from "vitest";
import { KEEP_MS, placeToKeep, placeToRestore } from "../web/place";

// Where the person was when the app went to the background (the search, how far down the
// list, the word open), so that if Android kills it there, it comes back to the same place.

const now = 1_800_000_000_000;

describe("where the person was", () => {
  it("is kept as text, and read back the same", () => {
    const kept = placeToKeep({ query: "ate", scrollTop: 1234, word: "serrate" }, now);
    expect(placeToRestore(kept, now + 60_000)).toEqual({ at: now, query: "ate", scrollTop: 1234, word: "serrate" });
  });

  it("is nothing on the start screen", () => {
    expect(placeToKeep({ query: "  ", scrollTop: 0, word: null }, now)).toBeNull();
  });

  it("goes stale: after half an hour the app starts fresh", () => {
    const kept = placeToKeep({ query: "ate", scrollTop: 0, word: null }, now);
    expect(placeToRestore(kept, now + KEEP_MS - 1)).not.toBeNull();
    expect(placeToRestore(kept, now + KEEP_MS + 1)).toBeNull();
    expect(KEEP_MS).toBe(30 * 60_000);
  });

  it("ignores anything it doesn't recognise (nothing kept, or a damaged entry)", () => {
    for (const stored of [null, "", "not json", "{}", '{"at":"x","query":"ate"}', '{"at":1,"query":7}', '[1,2]']) {
      expect(placeToRestore(stored, now)).toBeNull();
    }
  });

  it("keeps sane values only", () => {
    const stored = JSON.stringify({ at: now, query: "a".repeat(500), scrollTop: -5, word: 3 });
    const place = placeToRestore(stored, now)!;
    expect(place.query.length).toBeLessThanOrEqual(100);
    expect(place.scrollTop).toBe(0);
    expect(place.word).toBeNull();
  });

  it("is never from the future (a clock set back)", () => {
    const kept = placeToKeep({ query: "ate", scrollTop: 0, word: null }, now + 10 * KEEP_MS);
    expect(placeToRestore(kept, now)).toBeNull();
  });
});
