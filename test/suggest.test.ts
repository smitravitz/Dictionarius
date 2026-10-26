import { describe, it, expect } from "vitest";
import { Dictionary } from "../src/dictionary";
import type { DictionarySource, Entry } from "../src/source";

const attribution = { source: "Wiktionary", license: "CC-BY-SA-4.0" };
const entry = (headword: string): Entry => ({
  headword,
  senses: [{ partOfSpeech: "noun", gloss: `def of ${headword}` }],
  attribution,
});

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

describe("Dictionary.suggest", () => {
  it("returns prefix completions sorted alphabetically", async () => {
    const dict = new Dictionary(
      sourceReturning([entry("cat"), entry("car"), entry("cactus"), entry("dog")]),
    );

    const out = await dict.suggest("ca");

    // Everything starting with "ca", alphabetical. "dog" excluded.
    expect(out).toEqual(["cactus", "car", "cat"]);
  });

  it("falls back to a fuzzy 'did you mean' when nothing matches by prefix", async () => {
    const dict = new Dictionary(
      sourceReturning([entry("receive"), entry("receipt"), entry("deceive")]),
    );

    // Nothing starts with "recieve" (typo). Closest by edit distance is "receive" (2).
    const out = await dict.suggest("recieve");

    expect(out).toEqual(["receive"]);
  });

  it("returns nothing for an empty query", async () => {
    const dict = new Dictionary(sourceReturning([entry("apple")]));
    expect(await dict.suggest("")).toEqual([]);
  });
});
