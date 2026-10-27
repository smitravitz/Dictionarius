import { describe, it, expect } from "vitest";
import { splitOnFragment } from "../src/highlight";

// Where the typed fragment sits inside a word as displayed (capitals,
// diacritics and all), so the UI can align every row on it.
describe("splitOnFragment", () => {
  const cases: [string, string, [string, string, string]][] = [
    ["information", "tion", ["informa", "tion", ""]],
    ["really", "re", ["", "re", "ally"]],
    ["London", "ond", ["L", "ond", "on"]],
    ["Résumé", "sum", ["Ré", "sum", "é"]], // diacritics folded for matching, kept for display
    ["Hawaiʻi", "ii", ["Hawa", "iʻi", ""]], // ʻ normalizes away, so it belongs inside the match
    ["ice cream", "e c", ["ic", "e c", "ream"]], // spaces count (normalize() only trims the ends)
    ["ΟΔΟΣ", "δος", ["Ο", "ΔΟΣ", ""]], // final sigma lowercases differently letter by letter
    ["😀 emoji", "emo", ["😀 ", "emo", "ji"]], // astral characters stay whole
  ];

  for (const [display, query, [before, match, after]] of cases) {
    it(`${display} / ${query}`, () => {
      expect(splitOnFragment(display, query)).toEqual({ before, match, after });
    });
  }

  it("returns null when the fragment is not in the word", () => {
    expect(splitOnFragment("serene", "qzx")).toBeNull();
    expect(splitOnFragment("serene", "")).toBeNull();
  });
});
