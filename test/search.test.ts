import { describe, it, expect } from "vitest";
import { Dictionary } from "../src/dictionary";
import type { DictionarySource, Entry } from "../src/source";

const attribution = { source: "Wiktionary", license: "CC-BY-SA-4.0" };
const entry = (headword: string): Entry => ({
  headword,
  senses: [{ partOfSpeech: "noun", gloss: `def of ${headword}` }],
  attribution,
});

// Dumb candidate provider: returns the whole bag regardless of query, so the
// test exercises Dictionary's own matching + ranking, not the store's.
function sourceReturning(candidates: Entry[]): DictionarySource {
  return {
    async getByHeadword() {
      return null;
    },
    async getCandidates() {
      return candidates;
    },
  };
}

describe("Dictionary.search", () => {
  it("is diacritic- and case-insensitive and ranks exact > prefix, excluding non-matches", async () => {
    const dict = new Dictionary(
      sourceReturning([entry("café"), entry("cafeteria"), entry("coffee")]),
    );

    const hits = await dict.search("cafe");

    // Independent expected order (from the spec, not recomputed from code):
    // "café" normalizes to "cafe" -> exact; "cafeteria" -> prefix; "coffee" excluded.
    expect(hits.map((h) => h.headword)).toEqual(["café", "cafeteria"]);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("matches ignoring letter case", async () => {
    const dict = new Dictionary(sourceReturning([entry("run"), entry("runway")]));
    const hits = await dict.search("RUN");
    expect(hits.map((h) => h.headword)).toEqual(["run", "runway"]);
  });

  it("returns an empty list when nothing matches", async () => {
    const dict = new Dictionary(sourceReturning([entry("apple")]));
    expect(await dict.search("zzz")).toEqual([]);
  });
});
