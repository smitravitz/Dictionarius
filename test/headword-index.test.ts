import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { HeadwordIndex } from "../src/headword-index";
import { normalize } from "../src/normalize";

const FIXTURE = "test/fixtures/headwords-sample";

// Golden answers are computed by brute force in scripts/build_fm_index.py,
// independently of the FM-index, so these tests check the loader against an
// outside source of truth.
interface Golden {
  file: { numWords: number; normId: string };
  exact: { q: string; id: number | null }[];
  prefix: { q: string; start: number | null; count: number }[];
  substring: { q: string; occurrences: number; wordCount: number; wordIds?: number[] }[];
  extract: { id: number; word: string }[];
  display: { id: number; forms: string[] }[];
  freq: { id: number; zipf100: number }[];
  normalize: [string, string][];
}

function load(base: string) {
  return {
    bytes: new Uint8Array(readFileSync(`${base}.bin`)),
    golden: JSON.parse(readFileSync(`${base}.golden.json`, "utf8")) as Golden,
  };
}

/** The same behavioral suite for any index file + its golden answers. */
function describeAgainstGolden(name: string, base: string) {
  const present = existsSync(`${base}.bin`) && existsSync(`${base}.golden.json`);
  describe.skipIf(!present)(`HeadwordIndex vs golden: ${name}`, () => {
    const { bytes, golden } = present ? load(base) : ({} as ReturnType<typeof load>);
    const index = present ? HeadwordIndex.fromBytes(bytes) : (null as unknown as HeadwordIndex);

    it("opens the file and reports its word count", () => {
      expect(index.size).toBe(golden.file.numWords);
    });

    it("normalizes queries exactly as the index builder did (cross-language contract)", () => {
      for (const [input, expected] of golden.normalize) {
        expect(normalize(input), JSON.stringify(input)).toBe(expected);
      }
    });

    it("finds the exact word id for a search key, or null when absent", () => {
      for (const { q, id } of golden.exact) {
        expect(index.exact(q), q).toBe(id);
      }
    });

    it("returns words starting with a key as one contiguous id range", () => {
      for (const { q, start, count } of golden.prefix) {
        const got = index.prefix(q);
        expect(got.count, q).toBe(count);
        if (count > 0) expect(got.start, q).toBe(start);
      }
      expect(index.prefix("qzxqzxqzx").count).toBe(0);
    });

    it("counts mid-word occurrences and finds every word containing a key", () => {
      for (const { q, occurrences, wordCount, wordIds } of golden.substring) {
        expect(index.countOccurrences(q), q).toBe(occurrences);
        if (wordIds) expect(index.wordsContaining(q), q).toEqual(wordIds);
        else if (occurrences <= 25_000) expect(index.wordsContaining(q).length, q).toBe(wordCount);
      }
    });

    it("rebuilds a word's search key from its id, first and last included", () => {
      for (const { id, word } of golden.extract) {
        expect(index.key(id), String(id)).toBe(word);
      }
      expect(() => index.key(-1)).toThrow(RangeError);
      expect(() => index.key(golden.file.numWords)).toThrow(RangeError);
    });

    it("lists display forms (capitals, diacritics), plain key first when it is a headword", () => {
      for (const { id, forms } of golden.display) {
        expect(index.displayForms(id), String(id)).toEqual(forms);
      }
    });

    it("gives every word at least one display form that normalizes back to its key", () => {
      for (const { id } of [...golden.extract, ...golden.display]) {
        const forms = index.displayForms(id);
        expect(forms.length, String(id)).toBeGreaterThan(0);
        for (const form of forms) expect(normalize(form), form).toBe(index.key(id));
      }
    });

    it("reports word frequency on the Zipf scale", () => {
      for (const { id, zipf100 } of golden.freq) {
        expect(index.frequency(id), String(id)).toBeCloseTo(zipf100 / 100, 6);
      }
    });

    it("treats an empty key as a prefix of every word", () => {
      expect(index.prefix("")).toEqual({ start: 0, count: golden.file.numWords });
    });
  });
}

describeAgainstGolden("public-domain fixture", FIXTURE);
// Full-scale check against a real build, when one is available locally:
//   DICTIONARILY_INDEX=dist/headwords npx vitest run test/headword-index.test.ts
describeAgainstGolden("local build ($DICTIONARILY_INDEX or dist/headwords)", process.env.DICTIONARILY_INDEX ?? "dist/headwords");

describe("HeadwordIndex rejects files it can't trust", () => {
  const { bytes } = load(FIXTURE);

  /** A copy of the fixture with `patch` applied to its bytes. */
  const tampered = (patch: (b: Uint8Array) => void) => {
    const copy = bytes.slice();
    patch(copy);
    return copy;
  };

  it("rejects a file that is not a headword index", () => {
    const junk = new TextEncoder().encode("this is not an index ".repeat(10));
    expect(() => HeadwordIndex.fromBytes(junk)).toThrow(/not a headword index/);
  });

  it("rejects a format version it does not understand", () => {
    const v2 = tampered((b) => new DataView(b.buffer).setUint32(8, 2, true));
    expect(() => HeadwordIndex.fromBytes(v2)).toThrow(/version/);
  });

  it("rejects an index built with a different normalization rule", () => {
    const other = tampered((b) => b.set(new TextEncoder().encode("nfc-v9"), 44));
    expect(() => HeadwordIndex.fromBytes(other)).toThrow(/normalization/);
  });

  it("rejects a truncated file instead of reading garbage", () => {
    expect(() => HeadwordIndex.fromBytes(bytes.slice(0, bytes.length >> 1))).toThrow(/truncated|corrupt/);
  });

  it("opens bytes that do not start on an 8-byte boundary", () => {
    const shifted = new Uint8Array(bytes.length + 3).subarray(3);
    shifted.set(bytes);
    const index = HeadwordIndex.fromBytes(shifted);
    expect(index.exact(index.key(0))).toBe(0);
  });
});
