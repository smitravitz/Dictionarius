import { describe, it, expect } from "vitest";
import type { DictionarySource, Entry } from "../src/source";

const attribution = { source: "Wiktionary", license: "CC-BY-SA-4.0" };
export const entry = (headword: string, senses = 1): Entry => ({
  headword,
  senses: Array.from({ length: senses }, (_, i) => ({
    partOfSpeech: "noun",
    gloss: `sense ${i} of ${headword}`,
  })),
  attribution,
});

/**
 * The behavioral contract every DictionarySource must satisfy. Run it against
 * the in-memory fixture AND the real SQLite adapter — if both pass, the real
 * store is a verified drop-in for the mock used everywhere else.
 *
 * makeSource must return a source already populated with `entries`.
 */
export function describeDictionarySourceContract(
  name: string,
  makeSource: (entries: Entry[]) => Promise<DictionarySource>,
): void {
  describe(`DictionarySource contract: ${name}`, () => {
    it("round-trips a full entry by exact headword", async () => {
      const src = await makeSource([entry("run", 2), entry("walk")]);
      const got = await src.getByHeadword("run");

      expect(got).not.toBeNull();
      expect(got!.headword).toBe("run");
      expect(got!.senses).toHaveLength(2);
      expect(got!.attribution.license).toBe("CC-BY-SA-4.0");
    });

    it("returns null for an absent headword", async () => {
      const src = await makeSource([entry("run")]);
      expect(await src.getByHeadword("missing")).toBeNull();
    });

    it("returns candidates by normalized (diacritic/case-folded) prefix", async () => {
      const src = await makeSource([entry("café"), entry("Cafeteria"), entry("dog")]);
      const heads = (await src.getCandidates("caf")).map((e) => e.headword).sort();

      // Must INCLUDE both café and Cafeteria (folded match), EXCLUDE dog.
      expect(heads).toEqual(["Cafeteria", "café"]);
    });

    it("hands back full entries so callers can rank/attribute them", async () => {
      const src = await makeSource([entry("café")]);
      const [cand] = await src.getCandidates("caf");
      expect(cand.senses.length).toBeGreaterThan(0);
      expect(cand.attribution.source).toBe("Wiktionary");
    });
  });
}
