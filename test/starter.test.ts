import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { HeadwordIndex } from "../src/headword-index";
import { Completer, countsOf } from "../src/complete";
import { defaultFilters, filterKey } from "../src/filters";
import { normalize } from "../src/normalize";
import { SAFE_SEARCH_OVERRIDES } from "../src/safe-search-overrides";
import { LANDINGS, buildStarter, landingFrom, rowsFrom, starterKeys, type Starter } from "../src/starter";
import { PIECES } from "../web/examples";

// The starter: what a browser needs to show the app before the word list is in. The
// start screen's suggestions open from it at once, landed where the word list would
// land them, with the same words in the same order and the same counts. It's read back
// as JSON, so these tests read it back as JSON too.

const index = HeadwordIndex.fromBytes(new Uint8Array(readFileSync("test/fixtures/headwords-sample.bin")));
const completer = new Completer(index, SAFE_SEARCH_OVERRIDES);
const filters = defaultFilters();
const key = filterKey(filters);
const asRead = (s: Starter): Starter => JSON.parse(JSON.stringify(s)) as Starter;
const starter = asRead(buildStarter(index, completer, PIECES.map(([p]) => p), filters));
const PAGE = 50;

/** The list the word list itself gives for `piece`, every word counted. */
function live(piece: string) {
  const m = completer.search(piece, { filters });
  while (!m.complete) m.count(1_000_000);
  return m;
}

describe("starter", () => {
  it("opens every suggestion where, and as, the word list would: same words, order and counts", () => {
    let withWords = 0;
    for (const [piece] of PIECES) {
      const m = live(piece);
      for (const pick of [0, 0.5, 0.999]) {
        const answer = landingFrom(starter, normalize(piece), key, () => pick)!;
        expect(answer, piece).not.toBeNull();
        expect(answer.counts, piece).toEqual(countsOf(m, key));
        const total = m.total!;
        if (total === 0) {
          expect(answer.items).toEqual([]);
          continue;
        }
        withWords++;
        // Lands 43–57% of the way down, with whole pages from a little above to a screen below.
        expect(answer.landAt).toBeGreaterThanOrEqual(Math.round((total - 1) * 0.43));
        expect(answer.landAt).toBeLessThanOrEqual(Math.round((total - 1) * 0.57));
        expect(answer.from % PAGE).toBe(0);
        expect(answer.from).toBeLessThanOrEqual(Math.max(0, answer.landAt - 8));
        expect(answer.from + answer.items.length).toBeGreaterThanOrEqual(Math.min(total, answer.landAt + 60));
        expect(answer.items).toEqual(m.rows(answer.from, answer.from + answer.items.length));
      }
    }
    expect(withWords).toBeGreaterThan(20); // the fixture has words for most pieces
  });

  it(`keeps ${LANDINGS} spots per suggestion, so tapping it again can open somewhere new`, () => {
    const piece = PIECES.map(([p]) => p).sort((a, b) => live(b).total! - live(a).total!)[0];
    const spots = new Set([0, 0.4, 0.7, 0.999].map((pick) => landingFrom(starter, piece, key, () => pick)!.landAt));
    expect(spots.size).toBe(LANDINGS);
  });

  it("answers only for the filters it was built with, and only for its suggestions", () => {
    const other = filterKey({ ...filters, "safe-search": false });
    expect(landingFrom(starter, normalize(PIECES[0][0]), other)).toBeNull();
    expect(landingFrom(starter, "zzzq", key)).toBeNull();
  });

  it("gives the rows a landing holds, a page at a time, and none it doesn't hold", () => {
    const piece = normalize(PIECES[0][0]);
    const answer = landingFrom(starter, piece, key, () => 0)!;
    const m = live(piece);
    expect(rowsFrom(starter, piece, key, answer.from, answer.from + PAGE)).toEqual(m.rows(answer.from, answer.from + PAGE));
    expect(rowsFrom(starter, piece, key, answer.from + 100_000, answer.from + 100_000 + PAGE)).toBeNull();
    expect(rowsFrom(starter, piece, "other", answer.from, answer.from + PAGE)).toBeNull();
  });

  it("knows its words' keys, and the word list it was made from", () => {
    const keys = starterKeys(starter);
    expect(keys.size).toBe(index.size);
    expect(Array.from(keys.keysHash()!)).toEqual(Array.from(index.keysHash()!));
    const answer = landingFrom(starter, normalize(PIECES[0][0]), key, () => 0)!;
    for (const s of answer.items) expect(keys.key(s.id)).toBe(index.key(s.id));
    expect(() => keys.key(index.size + 5)).toThrow();
  });

  it("holds the word count and filters the start screen shows", () => {
    expect(starter.words).toBe(index.size);
    expect(starter.available).toEqual(completer.availableFilters());
  });
});
