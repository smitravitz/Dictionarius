import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { HeadwordIndex } from "../src/headword-index";
import { Completer, type Matches, type ResultCursor } from "../src/complete";
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
// The fixture's made-up labelled words (test/fixtures/README.md): these are
// explicit; "gapword" (a slur further down), "mixedword" (a vulgar meaning
// further down) and "hedgeword" (a dated, offensive one) aren't.
const EXPLICIT = new Set(["rudeword", "rudewords", "rudewurd", "slurword"]);

function oracle(query: string, fromOffset = 0, safe = false, explicit = EXPLICIT, hide = (_key: string) => false): Row[] {
  const q = normalize(query);
  if (!q) return [];
  const rows: (Row & { exact: boolean; shape: number; score: number })[] = [];
  keys.forEach((key, id) => {
    const offset = offsetOf(key, q);
    if (offset < fromOffset) return;
    if ((safe && explicit.has(key)) || hide(key)) return; // hidden, even typed out in full
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

/** Safe search on, nothing else. */
const SAFE = { filters: { "safe-search": true } };

/** A search's rows and every count it reports agree with the oracle's rows. */
function expectAgrees(m: Matches, rows: Row[], q: string, label = q) {
  const shown = rows.map((r) => keys[r.id]);
  const n = normalize(q);
  expect(m.starts, `${label} starts`).toBe(shown.filter((k) => k.startsWith(n)).length);
  expect(drain(m.cursor()), `${label} rows`).toEqual(rows);
  while (!m.count(1_000));
  expect(m.ends, `${label} ends`).toBe(shown.filter((k) => k.endsWith(n)).length);
  expect(m.total, `${label} total`).toBe(shown.length);
  const byOffset: number[] = [];
  for (const r of rows) byOffset[r.offset] = (byOffset[r.offset] ?? 0) + 1;
  expect([...m.byOffset], `${label} by offset`).toEqual(Array.from(byOffset, (x) => x ?? 0));
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

  it("reads any stretch of the list directly, without paging from the top", () => {
    for (const q of ["e", "an", "ing"]) {
      const all = oracle(q).map((r) => r.id);
      const m = completer.search(q);
      for (const [from, to] of [[2000, 2050], [0, 10], [all.length - 5, all.length + 20], [all.length + 5, all.length + 10]]) {
        expect(m.rows(from, to).map((s) => s.id), `${q} ${from}-${to}`).toEqual(all.slice(Math.max(0, from), Math.max(0, to)));
      }
    }
  });

  it("knows the row where each position starts", () => {
    for (const q of ["e", "ate", "ing"]) {
      const all = oracle(q);
      const m = completer.search(q);
      for (const offset of [0, 1, 2, 5, 9, 99]) {
        const first = all.findIndex((r) => r.offset >= offset);
        expect(m.startOf(offset), `${q} @${offset}`).toBe(first < 0 ? all.length : first);
      }
    }
  });

  it("knows how many rows exist so far, up to the total", () => {
    const m = completer.search("e");
    expect(m.known).toBe(0);
    m.rows(0, 1);
    expect(m.known).toBeGreaterThan(0);
    while (!m.count(1_000));
    expect(m.known).toBe(m.total);
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
      for (const q of ["rude", "word", "urd", "e", "slur", "mixed", "gap", "hedge"]) {
        expect(drain(completer.search(q, SAFE).cursor()), q).toEqual(oracle(q, 0, true));
      }
      const shown = drain(completer.search("word", SAFE).cursor()).map((r) => keys[r.id]);
      for (const word of ["mixedword", "hedgeword", "gapword", "gapwords"]) expect(shown).toContain(word);
      for (const word of EXPLICIT) expect(shown).not.toContain(word);
    });

    it("hides an explicit word even when it is typed out in full", () => {
      const m = completer.search("rudeword", SAFE);
      expect(drain(m.cursor())).toEqual([]);
      while (!m.count(1_000));
      expect([m.starts, m.ends, m.total]).toEqual([0, 0, 0]);
      expect(m.occurrences).toBeGreaterThan(0); // there is such a word: safe search hid it
    });

    it("shows everything with safe search off", () => {
      const shown = drain(completer.search("rude", {}).cursor()).map((r) => keys[r.id]);
      for (const word of ["rudeword", "rudewords", "rudewurd"]) expect(shown).toContain(word);
    });

    it("counts only what it shows", () => {
      for (const q of ["rude", "word", "s", "rudeword"]) expectAgrees(completer.search(q, SAFE), oracle(q, 0, true), q);
    });

    describe("with overrides", () => {
      // Words the labels missed are blocked; words they caught by mistake are allowed.
      const tuned = new Completer(index, { block: ["Banana", "air gap", "no such word"], allow: ["rudewords"] });
      const explicit = new Set([...EXPLICIT, "banana", "air gap"]);
      explicit.delete("rudewords");

      it("hides blocked words and shows allowed ones, and counts what it shows", () => {
        for (const q of ["an", "rude", "gap", "word", "e", "banana"]) {
          expectAgrees(tuned.search(q, SAFE), oracle(q, 0, true, explicit), q);
        }
        const an = drain(tuned.search("an", SAFE).cursor()).map((r) => keys[r.id]);
        expect(an).not.toContain("banana");
        const rude = drain(tuned.search("rude", SAFE).cursor()).map((r) => keys[r.id]);
        expect(rude).toContain("rudewords");
        expect(rude).not.toContain("rudeword");
      });

      it("leaves safe search off alone", () => {
        for (const q of ["an", "rude"]) expect(drain(tuned.search(q).cursor()), q).toEqual(oracle(q));
      });
    });

    describe("with a piece to hide wherever it appears", () => {
      // "snigger" reads as the slur in it: every word containing a blocked
      // piece is hidden, unless it is allowed.
      const netted = new Completer(index, { contains: ["Gap"], allow: ["air gap"] });

      it("hides every word containing it, except allowed ones, and counts what it shows", () => {
        const explicit = new Set([...EXPLICIT, ...keys.filter((k) => k.includes("gap") && k !== "air gap")]);
        expect(explicit.size).toBeGreaterThan(EXPLICIT.size + 1);
        for (const q of ["ga", "a", "gap", "air"]) expectAgrees(netted.search(q, SAFE), oracle(q, 0, true, explicit), q);
        const air = drain(netted.search("air", SAFE).cursor()).map((r) => keys[r.id]);
        expect(air).toContain("air gap");
      });
    });
  });

  describe("filters", () => {
    // Each filter's rule, written independently of the index's columns.
    const phrase = (key: string) => /\s/.test(key);

    it("leaves out phrases (entries with spaces) but keeps hyphenated words, and counts what it shows", () => {
      for (const q of ["e", "an", "-", "ice", "a b"]) {
        expectAgrees(completer.search(q, { filters: { phrases: true } }), oracle(q, 0, false, EXPLICIT, phrase), q);
      }
      const hyphen = drain(completer.search("-", { filters: { phrases: true } }).cursor()).map((r) => keys[r.id]);
      expect(hyphen.length).toBeGreaterThan(0);
      expect(hyphen.some(phrase)).toBe(false);
    });

    it("leaves out names: words whose most common spelling is a proper noun", () => {
      // The fixture's made-up names. "turkeyword" (a bird) outranks "Turkeyword" (a country).
      const NAMES = new Set(["zorbleton", "quillmarch"]);
      const name = (key: string) => NAMES.has(key);
      for (const q of ["zorble", "quill", "turkeyword", "o", "march"]) {
        expectAgrees(completer.search(q, { filters: { names: true } }), oracle(q, 0, false, EXPLICIT, name), q);
      }
      const turkey = drain(completer.search("turkeyword", { filters: { names: true } }).cursor());
      expect(turkey.map((r) => keys[r.id])).toEqual(["turkeyword"]);
    });

    it("keeps words whose length is within a range, either end of which can be any", () => {
      const chars = (key: string) => Array.from(key).length;
      const ranges: [number | null, number | null][] = [[4, null], [null, 3], [4, 6], [5, 5], [null, null]];
      for (const [min, max] of ranges) {
        const outside = (key: string) => (min !== null && chars(key) < min) || (max !== null && chars(key) > max);
        for (const q of ["e", "an", "ing", "résumé"]) {
          const m = completer.search(q, { filters: { length: [min, max] } });
          expectAgrees(m, oracle(q, 0, false, EXPLICIT, outside), q, `${q} [${min}, ${max}]`);
        }
      }
    });

    it("combines every filter: the defaults, with a length range", () => {
      const NAMES = new Set(["zorbleton", "quillmarch"]);
      const hide = (key: string) => /\s/.test(key) || NAMES.has(key) || Array.from(key).length < 4;
      const filters = { "safe-search": true, phrases: true, names: true, length: [4, null] as const };
      for (const q of ["e", "word", "or", "rude", "a b"]) {
        expectAgrees(completer.search(q, { filters }), oracle(q, 0, true, EXPLICIT, hide), q);
      }
    });

    it("offers the filters this index has data for, with each range's largest value", () => {
      const longest = Math.min(255, Math.max(...keys.map((k) => Array.from(k).length)));
      expect(completer.availableFilters().map((f) => (f.kind === "range" ? [f.id, f.min, f.max] : f.id))).toEqual([
        "safe-search",
        "phrases",
        "names",
        ["length", 1, longest],
      ]);
    });

    it("knows what ends with the query at once without filters, and once counted with them", () => {
      expect(completer.search("e").ends).toBe(keys.filter((k) => k.endsWith("e")).length);
      const m = completer.search("e", { filters: { phrases: true } });
      expect(m.ends).toBeNull();
      while (!m.count(1_000));
      expect(m.ends).toBe(keys.filter((k) => k.endsWith("e") && !phrase(k)).length);
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
