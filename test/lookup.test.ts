import { describe, it, expect } from "vitest";
import { Dictionary } from "../src/dictionary";
import type { DictionarySource } from "../src/source";

// A fixture source stands in for the real (SQLite/JSON) store — the system
// boundary we mock. Expected values below are independent literals, not
// recomputations of the implementation.
function sourceWith(entries: Record<string, unknown>): DictionarySource {
  return {
    async getByHeadword(word: string) {
      return (entries[word] as any) ?? null;
    },
    async getCandidates() {
      return [];
    },
  };
}

describe("Dictionary.lookup", () => {
  it("returns the entry for an exact word match", async () => {
    const dict = new Dictionary(
      sourceWith({
        run: {
          headword: "run",
          senses: [
            { partOfSpeech: "verb", gloss: "to move swiftly on foot" },
            { partOfSpeech: "noun", gloss: "an act of running" },
          ],
          attribution: { source: "Wiktionary", license: "CC-BY-SA-4.0" },
        },
      }),
    );

    const entry = await dict.lookup("run");

    expect(entry).not.toBeNull();
    expect(entry!.headword).toBe("run");
    expect(entry!.senses).toHaveLength(2);
    expect(entry!.senses[0].partOfSpeech).toBe("verb");
    // Share-alike data => attribution must survive to the caller.
    expect(entry!.attribution.license).toBe("CC-BY-SA-4.0");
  });

  it("returns null when the word is absent", async () => {
    const dict = new Dictionary(sourceWith({}));
    expect(await dict.lookup("nonexistentword")).toBeNull();
  });
});
