import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { HeadwordIndex } from "../src/headword-index";
import { Completer, type ResultCursor } from "../src/complete";
import { normalize } from "../src/normalize";

const index = HeadwordIndex.fromBytes(new Uint8Array(readFileSync("test/fixtures/headwords-sample.bin")));

// Independent oracle: scan every word and sort. The exact match comes first.
// Then words by how many characters come before the (first) match: words that
// start with the query, then one character before it, then two, and so on.
// Within one position: single words, then hyphenated words, then entries with
// spaces; then by score (Zipf x 100); then alphabetical (id).
// No FM-index, no walk, no buckets.
let keys: string[] = [];
beforeAll(() => {
  keys = Array.from({ length: index.size }, (_, id) => index.key(id));
});

/** 0 = one word, 1 = hyphenated (no spaces), 2 = has spaces. Spec: docs/index-format.md */
const shapeOf = (key: string) => (/\s/.test(key) ? 2 : /[-‐-—]/.test(key) ? 1 : 0);
/** Characters (code points) before the first match, or -1. */
function offsetOf(key: string, q: string): number {
  const at = key.indexOf(q);
  return at < 0 ? -1 : Array.from(key.slice(0, at)).length;
}

interface Row {
  id: number;
  offset: number;
}
// The fixture's made-up labelled words (test/fixtures/README.md): these four
// are explicit; "mixedword" has an ordinary meaning too, so it isn't.
const EXPLICIT = new Set(["rudeword", "rudewords", "rudewurd", "slurword"]);

function oracle(query: string, fromOffset = 0, safe = false): Row[] {
  const q = normalize(query);
  if (!q) return [];
  const rows: (Row & { exact: boolean; shape: number; score: number })[] = [];
  keys.forEach((key, id) => {
    const offset = offsetOf(key, q);
    if (offset < fromOffset) return;
    if (safe && EXPLICIT.has(key) && key !== q) return; // hidden unless typed in full
    rows.push({ id, offset, exact: key === q, shape: shapeOf(key), score: Math.round(index.frequency(id) * 100) });
  });
  rows.sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) ||
      a.offset - b.offset ||
      a.shape - b.shape ||
      b.score - a.score ||
      a.id - b.id,
  );
  return rows.map(({ id, offset }) => ({ id, offset }));
}

/** Page through a cursor until it is done. */
function drain(cursor: ResultCursor, pageSize = 50): Row[] {
  const out: Row[] = [];
  for (let guard = 0; !cursor.done; guard++) {
    if (guard > 100_000) throw new Error("cursor never finished");
    for (const s of cursor.next(pageSize)) out.push({ id: s.id, offset: s.offset });
  }
  return out;
}

// Short fragments (huge result sets), rare ones, exact words, repeats inside a
// word ("an" in "banana"), phrases, non-ASCII (offsets count characters, not
// bytes), and misses.
const QUERIES = ["e", "re", "an", "ing", "ati", "ste", "resume", "sum", "set", "ice cream", "air", "-", "東", "π", "о", "zz", "qzxqzx"];

describe("Completer", () => {
  const completer = new Completer(index);

  it("lists the exact match, then words by how many letters come before the match", () => {
    for (const q of QUERIES) {
      expect(drain(completer.search(q).cursor()), q).toEqual(oracle(q));
    }
  });

  it("puts every word that starts with the query first, then 1 letter before, then 2, and so on", () => {
    const offsets = drain(completer.search("ate").cursor()).map((r) => r.offset);
    expect(offsets[0]).toBe(0);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(new Set(offsets).size).toBeGreaterThan(5);
  });

  it("orders words at the same position: single words, hyphenated, then phrases", () => {
    const starts = drain(completer.search("air").cursor()).filter((r) => r.offset === 0).slice(1);
    const shapes = starts.map((r) => shapeOf(keys[r.id]));
    expect(new Set(shapes)).toEqual(new Set([0, 1, 2]));
    expect(shapes).toEqual([...shapes].sort((a, b) => a - b));
    for (let id = 0; id < index.size; id++) {
      if (index.shape(id) !== shapeOf(keys[id])) throw new Error(`shape of ${keys[id]}`);
    }
  });

  it("starts the list at a chosen number of letters before the match", () => {
    for (const q of ["e", "an", "ing", "ate"]) {
      for (const from of [1, 2, 3, 7]) {
        expect(drain(completer.search(q).cursor(from)), `${q} from ${from}`).toEqual(oracle(q, from));
      }
    }
  });

  it("serves several cursors from one search without redoing work", () => {
    const matches = completer.search("re");
    const a = matches.cursor(0).next(30).map((s) => s.id);
    const b = matches.cursor(2).next(30).map((s) => s.id);
    const c = matches.cursor(0).next(30).map((s) => s.id);
    expect(a).toEqual(oracle("re").slice(0, 30).map((r) => r.id));
    expect(b).toEqual(oracle("re", 2).slice(0, 30).map((r) => r.id));
    expect(c).toEqual(a);
  });

  it("counts words that start with, end with, and contain the query", () => {
    for (const q of ["e", "an", "ing", "ate", "ice cream", "東", "qzxqzx"]) {
      const m = completer.search(q);
      const n = normalize(q);
      expect(m.starts, `${q} starts`).toBe(keys.filter((k) => k.startsWith(n)).length);
      expect(m.ends, `${q} ends`).toBe(keys.filter((k) => k.endsWith(n)).length);
      while (!m.count(1_000));
      expect(m.complete).toBe(true);
      expect(m.total, `${q} total`).toBe(keys.filter((k) => k.includes(n)).length);
      // Words per position: the histogram the position slider draws.
      const expected: number[] = [];
      for (const r of oracle(q)) expected[r.offset] = (expected[r.offset] ?? 0) + 1;
      expect([...m.byOffset], `${q} by offset`).toEqual(Array.from(expected, (x) => x ?? 0));
    }
  });

  it("works out the counts a little at a time, and knows the total only at the end", () => {
    const m = completer.search("e");
    expect(m.total).toBeNull();
    let calls = 0;
    while (!m.count(200)) calls++;
    expect(calls).toBeGreaterThan(3);
    expect(m.total).toBe(keys.filter((k) => k.includes("e")).length);
  });

  it("returns pages that continue exactly where the previous one stopped", () => {
    const cursor = completer.search("re").cursor();
    const first = cursor.next(50).map((s) => s.id);
    const second = cursor.next(50).map((s) => s.id);
    const odd = [cursor.next(1), cursor.next(3), cursor.next(7)].flat().map((s) => s.id);
    expect([...first, ...second, ...odd]).toEqual(oracle("re").slice(0, 111).map((r) => r.id));
  });

  it("normalizes what the user typed", () => {
    expect(drain(completer.search("  RÉSUMÉ ").cursor())).toEqual(drain(completer.search("resume").cursor()));
  });

  it("is done immediately for an empty query or a fragment that matches nothing", () => {
    for (const q of ["", "   ", "qzxqzx"]) {
      const m = completer.search(q);
      const cursor = m.cursor();
      expect(cursor.next(50), JSON.stringify(q)).toEqual([]);
      expect(cursor.done).toBe(true);
      expect(m.count(1)).toBe(true);
      expect(m.total).toBe(0);
    }
  });

  describe("safe search", () => {
    it("leaves out explicit words, and keeps words with an ordinary meaning", () => {
      for (const q of ["rude", "word", "urd", "e", "slur", "mixed"]) {
        expect(drain(completer.search(q, { safe: true }).cursor()), q).toEqual(oracle(q, 0, true));
      }
      const shown = drain(completer.search("word", { safe: true }).cursor()).map((r) => keys[r.id]);
      expect(shown).toContain("mixedword");
      for (const word of EXPLICIT) expect(shown).not.toContain(word);
    });

    it("still shows an explicit word typed out in full, but not its relatives", () => {
      const shown = drain(completer.search("rudeword", { safe: true }).cursor()).map((r) => keys[r.id]);
      expect(shown).toEqual(["rudeword"]);
    });

    it("shows everything with safe search off", () => {
      const shown = drain(completer.search("rude", { safe: false }).cursor()).map((r) => keys[r.id]);
      for (const word of ["rudeword", "rudewords", "rudewurd"]) expect(shown).toContain(word);
    });

    it("counts only what it shows", () => {
      for (const q of ["rude", "word", "s", "rudeword"]) {
        const m = completer.search(q, { safe: true });
        const shown = oracle(q, 0, true).map((r) => keys[r.id]);
        const n = normalize(q);
        expect(m.starts, `${q} starts`).toBe(shown.filter((k) => k.startsWith(n)).length);
        expect(m.ends, `${q} ends`).toBe(shown.filter((k) => k.endsWith(n)).length);
        while (!m.count(1_000));
        expect(m.total, `${q} total`).toBe(shown.length);
        const byOffset: number[] = [];
        for (const r of oracle(q, 0, true)) byOffset[r.offset] = (byOffset[r.offset] ?? 0) + 1;
        expect([...m.byOffset], `${q} by offset`).toEqual(Array.from(byOffset, (x) => x ?? 0));
      }
    });
  });

  it("describes each result: display form, all forms, position, frequency", () => {
    const [top, next] = completer.search("resume").cursor().next(2);
    expect(top).toMatchObject({ key: "resume", display: "resume", offset: 0, exact: true });
    expect(top.forms).toEqual(["resume", "Resume", "Résumé", "résumé"]);
    expect(top.frequency).toBe(index.frequency(top.id));
    expect(next.exact).toBe(false);
  });
});
