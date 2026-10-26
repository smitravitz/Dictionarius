import { describe, it, expect } from "vitest";
import { describeDictionarySourceContract, entry } from "./source-contract";
import { FmIndexSource } from "../src/fm-index-source";

// FmIndexSource must be a verified drop-in: it satisfies the SAME contract as
// the in-memory mock and the SQLite adapter.
describeDictionarySourceContract("FmIndexSource", async (entries) => {
  const src = new FmIndexSource();
  await src.ingest(entries);
  return src;
});

// FM-index differentiator: true mid-word (substring) matching, which the
// prefix-only SQLite source cannot do. This is the capability the whole
// investigation was about.
describe("FmIndexSource mid-word matching", () => {
  it("finds words by an interior substring, not just a prefix", async () => {
    const src = new FmIndexSource();
    await src.ingest([
      entry("serene"),
      entry("coherent"),
      entry("adherence"),
      entry("dog"),
    ]);

    const heads = (await src.getCandidates("eren")).map((e) => e.headword).sort();

    // 'eren' is interior to serene/coherent/adherence, absent from dog.
    expect(heads).toEqual(["adherence", "coherent", "serene"]);
  });

  it("is diacritic- and case-insensitive on interior matches", async () => {
    const src = new FmIndexSource();
    await src.ingest([entry("Résumé"), entry("presume"), entry("dog")]);

    // normalized 'sum' is interior to resume + presume.
    const heads = (await src.getCandidates("SUM")).map((e) => e.headword).sort();
    expect(heads).toEqual(["Résumé", "presume"]);
  });

  it("returns nothing for a substring present in no headword", async () => {
    const src = new FmIndexSource();
    await src.ingest([entry("apple"), entry("banana")]);
    expect(await src.getCandidates("xyz")).toEqual([]);
  });
});
