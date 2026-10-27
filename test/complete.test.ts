import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { HeadwordIndex } from "../src/headword-index";
import { Completer, type ResultCursor } from "../src/complete";
import { normalize } from "../src/normalize";

const index = HeadwordIndex.fromBytes(new Uint8Array(readFileSync("test/fixtures/headwords-sample.bin")));

// Independent oracle: scan every word, bucket it, sort each bucket by
// frequency (desc) then id (asc = alphabetical). No FM-index, no heap.
let keys: string[] = [];
beforeAll(() => {
  keys = Array.from({ length: index.size }, (_, id) => index.key(id));
});

type Tier = "exact" | "prefix" | "midword";
function oracle(query: string): { id: number; tier: Tier }[] {
  const q = normalize(query);
  if (!q) return [];
  const byRank = (a: number, b: number) => index.frequency(b) - index.frequency(a) || a - b;
  const exact: number[] = [];
  const prefix: number[] = [];
  const midword: number[] = [];
  keys.forEach((key, id) => {
    if (key === q) exact.push(id);
    else if (key.startsWith(q)) prefix.push(id);
    else if (key.includes(q)) midword.push(id);
  });
  return [
    ...exact.map((id) => ({ id, tier: "exact" as Tier })),
    ...prefix.sort(byRank).map((id) => ({ id, tier: "prefix" as Tier })),
    ...midword.sort(byRank).map((id) => ({ id, tier: "midword" as Tier })),
  ];
}

/** Page through a cursor until it is done. */
function drain(cursor: ResultCursor, pageSize = 50) {
  const out: { id: number; tier: Tier }[] = [];
  for (let guard = 0; !cursor.done; guard++) {
    if (guard > 100_000) throw new Error("cursor never finished");
    for (const s of cursor.next(pageSize)) out.push({ id: s.id, tier: s.tier });
  }
  return out;
}

// Short fragments (huge result sets), rare ones, exact words, non-ASCII, misses.
const QUERIES = ["e", "re", "ing", "ati", "ste", "resume", "sum", "set", "ice cream", "東", "π", "zz", "qzxqzx"];

describe("Completer", () => {
  const completer = new Completer(index);

  it("ranks exact match, then prefix, then mid-word — each by frequency then alphabet", () => {
    for (const q of QUERIES) {
      expect(drain(completer.complete(q)), q).toEqual(oracle(q));
    }
  });

  it("gives the same order whether mid-words are located in full or scanned by frequency", () => {
    const alwaysScan = new Completer(index, { locateLimit: 0 });
    const alwaysLocate = new Completer(index, { locateLimit: Infinity });
    for (const q of QUERIES) {
      expect(drain(alwaysScan.complete(q)), `scan ${q}`).toEqual(oracle(q));
      expect(drain(alwaysLocate.complete(q)), `locate ${q}`).toEqual(oracle(q));
    }
  });

  it("fills a mid-word page from the hot list, without the slow scan", () => {
    // 'tion': no word starts with it, 116 hot-list words contain it. A scan
    // budget of 1 could never produce 50 results; the hot list must.
    const starved = new Completer(index, { locateLimit: 0, scanBudget: 1 });
    const page = starved.complete("tion").next(50);
    expect(page.map((s) => s.id)).toEqual(oracle("tion").slice(0, 50).map((r) => r.id));
  });

  it("gives identical results with the hot list switched off", () => {
    const noHot = new Completer(index, { useHot: false });
    for (const q of QUERIES) {
      expect(drain(noHot.complete(q)), q).toEqual(oracle(q));
    }
  });

  it("returns pages that continue exactly where the previous one stopped", () => {
    const cursor = completer.complete("re");
    const first = cursor.next(50).map((s) => s.id);
    const second = cursor.next(50).map((s) => s.id);
    const odd = [cursor.next(1), cursor.next(3), cursor.next(7)].flat().map((s) => s.id);
    expect([...first, ...second, ...odd]).toEqual(oracle("re").slice(0, 111).map((r) => r.id));
  });

  it("may return a short page under its work budget, but never skips or repeats", () => {
    const tight = new Completer(index, { locateLimit: 0, scanBudget: 7 });
    const cursor = tight.complete("ing");
    let shortPageBeforeDone = false;
    const ids: number[] = [];
    while (!cursor.done) {
      const page = cursor.next(50);
      if (page.length < 50 && !cursor.done) shortPageBeforeDone = true;
      ids.push(...page.map((s) => s.id));
    }
    expect(shortPageBeforeDone).toBe(true);
    expect(ids).toEqual(oracle("ing").map((r) => r.id));
  });

  it("normalizes what the user typed", () => {
    expect(drain(completer.complete("  RÉSUMÉ "))).toEqual(drain(completer.complete("resume")));
  });

  it("is done immediately for an empty query or a fragment that matches nothing", () => {
    for (const q of ["", "   ", "qzxqzx"]) {
      const cursor = completer.complete(q);
      expect(cursor.next(50), JSON.stringify(q)).toEqual([]);
      expect(cursor.done).toBe(true);
    }
  });

  it("describes each result: display form, all forms, tier, frequency", () => {
    const [top] = completer.complete("resume").next(1);
    expect(top.tier).toBe("exact");
    expect(top.key).toBe("resume");
    expect(top.forms).toEqual(["resume", "Resume", "Résumé", "résumé"]);
    expect(top.display).toBe("resume");
    expect(top.frequency).toBe(index.frequency(top.id));
  });

  it("reports how many words start with the query and how often it occurs", () => {
    const cursor = completer.complete("re");
    const all = oracle("re");
    expect(cursor.prefixCount).toBe(all.filter((r) => r.tier !== "midword").length);
    expect(cursor.occurrences).toBe(index.countOccurrences("re"));
  });
});
