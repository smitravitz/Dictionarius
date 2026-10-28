/**
 * Loads the headword index (an FM-index) built by scripts/build_fm_index.py and
 * answers searches over every headword. Binary layout: docs/index-format.md.
 *
 * Keys passed to these methods must already be normalized with normalize();
 * the index matches bytes exactly.
 */

import { NORMALIZATION_ID } from "./normalize";

const MAGIC = "DICTFMv1";
const VERSION = 1;
const HEADER_SIZE = 96;
const SECTION_SIZE = 16;
const SEP = 0x01;
const FLAG_FREQ = 1;
const FLAG_HOT = 2;
const FLAG_SHAPE = 4;

/** How a headword is written: 0 = one word, 1 = hyphenated (no spaces), 2 = with spaces. */
export type WordShape = 0 | 1 | 2;

/** Nodes at most this big are expanded by reading their BWT bytes; bigger ones
 *  by asking every symbol's rank (cheaper only for very wide ranges). */
const SCAN_LIMIT = 20_000;
/** UTF-8 continuation bytes (10xxxxxx) don't start a character. */
const startsChar = (byte: number) => (byte & 0xc0) !== 0x80;

/**
 * Every occurrence of a key, walked backwards towards the start of its word
 * one byte at a time, to learn how many characters come before it. Word ids
 * come out grouped by that offset. Lazy and resumable: `step` does a bounded
 * amount of work, so the first offsets are ready long before the last.
 */
export interface OffsetWalk {
  /** Do up to about `budget` units of work (bytes read, rank lookups); stops
   *  early when a level of the walk completes. Returns the units used. */
  step(budget: number): number;
  /** Offsets below this are final: no more words will be found for them. */
  readonly settled: number;
  readonly finished: boolean;
  /** Highest offset any word was found at so far (-1: none). */
  readonly maxOffset: number;
  /** Word ids found with `offset` characters before an occurrence of the key.
   *  A word whose key holds it twice is found at both offsets. */
  idsAt(offset: number): { ranges: readonly number[]; singles: readonly number[] };
}

const utf8 = new TextEncoder();
const utf8Decode = new TextDecoder("utf-8", { fatal: true });

interface Sections {
  C: Uint32Array;
  bwt: Uint8Array;
  denseOf: Int16Array; // byte -> dense column, or -1
  sparseOf: Int16Array; // byte -> sparse list, or -1
  numDense: number;
  superRank: Uint32Array;
  blockRank: Uint16Array;
  sparseOffsets: Uint32Array;
  sparsePositions: Uint32Array;
  freq: Uint16Array | null; // Zipf x 100, when the build included frequencies
  variantIds: Uint32Array; // ascending ids that have display forms
  variantOffsets: Uint32Array;
  variantBlob: Uint8Array; // per id: UTF-8 forms separated by 0x00
  hotKeys: Uint8Array | null; // keys of the top-ranked words, each ending in SEP
  shapes: Uint8Array | null; // per id: WordShape, when the build included shapes
}

export class HeadwordIndex {
  private hotTextCache: string | null = null;

  /** Every byte value that occurs in the BWT. */
  private readonly symbols: number[];

  private constructor(
    readonly size: number,
    /** Words in the hot list (top-ranked words; 0 if the file has none). */
    readonly hotCount: number,
    private readonly n: number,
    private readonly blockShift: number,
    private readonly superShift: number,
    private readonly s: Sections,
  ) {
    this.symbols = [];
    for (let c = 0; c < 256; c++) if (s.denseOf[c] >= 0 || s.sparseOf[c] >= 0) this.symbols.push(c);
  }

  /** Open an index from the raw bytes of a `.bin` file. */
  static fromBytes(bytes: Uint8Array): HeadwordIndex {
    if (bytes.byteLength < HEADER_SIZE || ascii(bytes, 0, 8) !== MAGIC) {
      throw new Error("not a headword index (bad magic)");
    }
    // Typed-array views need aligned offsets; copy once if the caller's aren't.
    if (bytes.byteOffset % 8 !== 0) bytes = bytes.slice();

    const header = new DataView(bytes.buffer, bytes.byteOffset, HEADER_SIZE);
    const u32 = (offset: number) => header.getUint32(offset, true);
    if (u32(8) !== VERSION) throw new Error(`unsupported index version ${u32(8)} (expected ${VERSION})`);
    const normId = ascii(bytes, 44, 48).replace(/\0+$/, "");
    if (normId !== NORMALIZATION_ID) {
      throw new Error(`index uses normalization rule "${normId}", app expects "${NORMALIZATION_ID}"`);
    }
    const n = u32(16);
    const numWords = u32(20);
    const numDense = u32(32);
    const numSparse = u32(36);
    const numSections = u32(40);

    const tableEnd = HEADER_SIZE + numSections * SECTION_SIZE;
    if (tableEnd > bytes.byteLength) throw new Error("corrupt or truncated index: section table");
    const table = new DataView(bytes.buffer, bytes.byteOffset + HEADER_SIZE, numSections * SECTION_SIZE);
    const where = new Map<string, { offset: number; length: number }>();
    for (let i = 0; i < numSections; i++) {
      const at = i * SECTION_SIZE;
      const name = ascii(bytes, HEADER_SIZE + at, 8).replace(/\0+$/, "");
      const offset = table.getUint32(at + 8, true);
      const length = table.getUint32(at + 12, true);
      if (offset % 8 !== 0 || offset + length > bytes.byteLength) {
        throw new Error(`corrupt or truncated index: section ${name}`);
      }
      where.set(name, { offset, length });
    }
    const view = <T>(name: string, Kind: { new (b: ArrayBufferLike, o: number, l: number): T; BYTES_PER_ELEMENT: number }) => {
      const sec = where.get(name);
      if (!sec || sec.length % Kind.BYTES_PER_ELEMENT !== 0) {
        throw new Error(`corrupt or truncated index: section ${name}`);
      }
      return new Kind(bytes.buffer, bytes.byteOffset + sec.offset, sec.length / Kind.BYTES_PER_ELEMENT);
    };

    const denseSymbols = view("DSYM", Uint8Array);
    const sparseSymbols = view("SSYM", Uint8Array);
    const denseOf = new Int16Array(256).fill(-1);
    const sparseOf = new Int16Array(256).fill(-1);
    denseSymbols.forEach((c, d) => (denseOf[c] = d));
    sparseSymbols.forEach((c, s) => (sparseOf[c] = s));

    const flags = u32(12);
    const hasHot = (flags & FLAG_HOT) !== 0;
    return new HeadwordIndex(numWords, hasHot ? u32(92) : 0, n, u32(24), u32(28), {
      C: view("C", Uint32Array),
      bwt: view("BWT", Uint8Array),
      denseOf,
      sparseOf,
      numDense,
      superRank: view("SUPER", Uint32Array),
      blockRank: view("BLOCK", Uint16Array),
      sparseOffsets: view("SOFF", Uint32Array),
      sparsePositions: view("SPOS", Uint32Array),
      freq: flags & FLAG_FREQ ? view("FREQ", Uint16Array) : null,
      variantIds: view("VIDS", Uint32Array),
      variantOffsets: view("VOFF", Uint32Array),
      variantBlob: view("VBLOB", Uint8Array),
      hotKeys: hasHot ? view("HOTK", Uint8Array) : null,
      shapes: flags & FLAG_SHAPE ? view("SHAPE", Uint8Array) : null,
    });
  }

  /**
   * Keys of the `hotCount` top-ranked words, in rank order, each followed by
   * "\u0001". Searching this text finds mid-word matches already ranked.
   * Decoded on first use; "" when the file has no hot list.
   */
  hotText(): string {
    if (this.hotTextCache === null) {
      this.hotTextCache = this.s.hotKeys ? utf8Decode.decode(this.s.hotKeys) : "";
    }
    return this.hotTextCache;
  }

  /** How a word is written: e.g. ["resume", "résumé"] or ["London"]. Never empty. */
  displayForms(id: number): string[] {
    const key = this.key(id); // also validates id
    const { variantIds, variantOffsets, variantBlob } = this.s;
    let lo = 0;
    let hi = variantIds.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (variantIds[mid] < id) lo = mid + 1;
      else hi = mid;
    }
    if (lo === variantIds.length || variantIds[lo] !== id) return [key];
    return utf8Decode.decode(variantBlob.subarray(variantOffsets[lo], variantOffsets[lo + 1])).split("\0");
  }

  /** Word frequency on the Zipf scale (about 1 = rare, 7+ = "the"); 0 when unknown. */
  frequency(id: number): number {
    if (!Number.isInteger(id) || id < 0 || id >= this.size) {
      throw new RangeError(`word id out of range: ${id}`);
    }
    return this.s.freq ? this.s.freq[id] / 100 : 0;
  }

  /** True when the file records word shapes (builds from before shapes: false). */
  get hasShapes(): boolean {
    return this.s.shapes !== null;
  }

  /** 0 = one word, 1 = hyphenated (no spaces), 2 = has spaces; 0 for every word
   *  in files built before shapes were recorded. */
  shape(id: number): WordShape {
    if (!Number.isInteger(id) || id < 0 || id >= this.size) {
      throw new RangeError(`word id out of range: ${id}`);
    }
    return this.s.shapes ? (this.s.shapes[id] as WordShape) : 0;
  }

  /** Word id whose search key is exactly `key`, or null. */
  exact(key: string): number | null {
    const [lo, hi] = this.range(framed(key, true));
    return hi - lo === 1 ? lo - this.s.C[SEP] - 1 : null;
  }

  /** Words starting with `key`: ids are contiguous because words are stored sorted. */
  prefix(key: string): { start: number; count: number } {
    // A bare SEP would also match the separator after the last word.
    if (key === "") return { start: 0, count: this.size };
    const [lo, hi] = this.range(framed(key, false));
    return hi > lo ? { start: lo - this.s.C[SEP] - 1, count: hi - lo } : { start: 0, count: 0 };
  }

  /** How many times `key` occurs anywhere inside headwords (mid-word included). */
  countOccurrences(key: string): number {
    if (key === "") return 0;
    const [lo, hi] = this.range(utf8.encode(key));
    return hi - lo;
  }

  /** How many words end with `key`. */
  countEndingWith(key: string): number {
    if (key === "") return 0;
    const body = utf8.encode(key);
    const pattern = new Uint8Array(body.length + 1);
    pattern.set(body);
    pattern[body.length] = SEP;
    const [lo, hi] = this.range(pattern);
    return hi - lo;
  }

  /**
   * Walk back from every occurrence of `key` to the start of its word. The
   * walk is a breadth-first search over the strings that precede the key:
   * level d holds one node per distinct d-byte string x such that x + key
   * occurs, as the BWT row range of x + key. A node's SEP child is the id
   * range of words starting with x + key; its other children form level d + 1.
   * A node with a single row is followed straight to its word.
   */
  offsetWalk(key: string): OffsetWalk {
    const { C, bwt } = this.s;
    const symbols = this.symbols;
    const occ = (c: number, i: number) => this.occ(c, i);
    const [lo0, hi0] = key === "" ? [0, 0] : this.range(utf8.encode(key));

    let level = { lo: [] as number[], hi: [] as number[], chars: [] as number[] };
    let next = { lo: [] as number[], hi: [] as number[], chars: [] as number[] };
    if (hi0 > lo0) {
      level.lo.push(lo0);
      level.hi.push(hi0);
      level.chars.push(0);
    }
    let pos = 0;
    const ranges: number[][] = []; // per offset: [loId, hiId, loId, hiId, …]
    const singles: number[][] = []; // per offset: word ids
    const counts = new Uint32Array(256);
    const touched: number[] = [];
    const state = { settled: hi0 > lo0 ? 0 : Infinity, finished: !(hi0 > lo0), maxOffset: -1 };

    const foundRange = (offset: number, loId: number, hiId: number) => {
      (ranges[offset] ??= []).push(loId, hiId);
      if (offset > state.maxOffset) state.maxOffset = offset;
    };
    const foundSingle = (offset: number, id: number) => {
      (singles[offset] ??= []).push(id);
      if (offset > state.maxOffset) state.maxOffset = offset;
    };
    // One row left: follow it to the separator in front of its word.
    const walkSingle = (row: number, chars: number): number => {
      let cost = 0;
      for (;;) {
        const c = bwt[row];
        cost++;
        if (c === SEP) {
          foundSingle(chars, occ(SEP, row) - 1);
          return cost;
        }
        if (c === 0) return cost; // TERM: not inside any word
        if (startsChar(c)) chars++;
        row = C[c] + occ(c, row);
      }
    };
    const child = (c: number, start: number, count: number, chars: number) => {
      if (c === SEP) {
        foundRange(chars, start - 1, start - 1 + count); // rows of SEP + x + key -> word ids
        return 0;
      }
      if (c === 0) return 0;
      const childChars = chars + (startsChar(c) ? 1 : 0);
      if (count === 1) return walkSingle(C[c] + start, childChars);
      next.lo.push(C[c] + start);
      next.hi.push(C[c] + start + count);
      next.chars.push(childChars);
      return 0;
    };
    const expand = (lo: number, hi: number, chars: number): number => {
      if (hi - lo === 1) return walkSingle(lo, chars);
      let cost = 0;
      if (hi - lo <= SCAN_LIMIT) {
        for (let row = lo; row < hi; row++) {
          const c = bwt[row];
          if (counts[c]++ === 0) touched.push(c);
        }
        cost += hi - lo;
        for (const c of touched) {
          cost += 1 + child(c, occ(c, lo), counts[c], chars);
          counts[c] = 0;
        }
        touched.length = 0;
      } else {
        for (const c of symbols) {
          const a = occ(c, lo);
          const b = occ(c, hi);
          cost += 2;
          if (b > a) cost += child(c, a, b - a, chars);
        }
      }
      return cost;
    };

    return {
      get settled() {
        return state.settled;
      },
      get finished() {
        return state.finished;
      },
      get maxOffset() {
        return state.maxOffset;
      },
      idsAt: (offset) => ({ ranges: ranges[offset] ?? [], singles: singles[offset] ?? [] }),
      step(budget) {
        let used = 0;
        while (!state.finished && used < budget) {
          used += expand(level.lo[pos], level.hi[pos], level.chars[pos]);
          pos++;
          if (pos < level.lo.length) continue;
          // Level done: every node left is in `next`, and none of them can
          // produce an offset below its own character count.
          [level, next] = [next, level];
          next.lo.length = next.hi.length = next.chars.length = 0;
          pos = 0;
          if (level.lo.length === 0) {
            state.finished = true;
            state.settled = Infinity;
          } else {
            state.settled = minOf(level.chars);
          }
          break;
        }
        return used;
      },
    };
  }

  /** Ids of every word containing `key`, ascending. Cost grows with the hit count. */
  wordsContaining(key: string): number[] {
    if (key === "") return [];
    const [lo, hi] = this.range(utf8.encode(key));
    const ids = new Set<number>();
    for (let row = lo; row < hi; row++) ids.add(this.locate(row));
    return [...ids].sort((a, b) => a - b);
  }

  /** The normalized search key of word `id`, read back out of the index. */
  key(id: number): string {
    if (!Number.isInteger(id) || id < 0 || id >= this.size) {
      throw new RangeError(`word id out of range: ${id}`);
    }
    // Start at the separator after the word and walk backwards through it.
    let row = this.s.C[SEP] + (id === this.size - 1 ? 0 : id + 2);
    const reversed: number[] = [];
    while (this.s.bwt[row] !== SEP) {
      reversed.push(this.s.bwt[row]);
      row = this.lf(row);
    }
    return utf8Decode.decode(Uint8Array.from(reversed.reverse()));
  }

  /** Word containing the occurrence at BWT `row`: walk back to its separator. */
  private locate(row: number): number {
    while (this.s.bwt[row] !== SEP) row = this.lf(row);
    return this.occ(SEP, row) - 1;
  }

  /** Last-to-first mapping: the row of the suffix one byte earlier in the text. */
  private lf(row: number): number {
    const c = this.s.bwt[row];
    return this.s.C[c] + this.occ(c, row);
  }

  /** Backward search: the half-open BWT row range of `pattern`. */
  private range(pattern: Uint8Array): [number, number] {
    const { C } = this.s;
    let lo = 0;
    let hi = this.n;
    for (let i = pattern.length - 1; i >= 0; i--) {
      const c = pattern[i];
      lo = C[c] + this.occ(c, lo);
      hi = C[c] + this.occ(c, hi);
      if (lo >= hi) return [0, 0];
    }
    return [lo, hi];
  }

  /** Occurrences of byte `c` in BWT[0, i). */
  private occ(c: number, i: number): number {
    const s = this.s;
    const d = s.denseOf[c];
    if (d >= 0) {
      const block = i >>> this.blockShift;
      let count = s.superRank[(i >>> this.superShift) * s.numDense + d] + s.blockRank[block * s.numDense + d];
      for (let p = block << this.blockShift; p < i; p++) if (s.bwt[p] === c) count++;
      return count;
    }
    const list = s.sparseOf[c];
    if (list < 0) return 0;
    let lo = s.sparseOffsets[list];
    let hi = s.sparseOffsets[list + 1];
    const start = lo;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (s.sparsePositions[mid] < i) lo = mid + 1;
      else hi = mid;
    }
    return lo - start;
  }
}

/** UTF-8 bytes of `key`, preceded by SEP (and followed by SEP when `closed`). */
function framed(key: string, closed: boolean): Uint8Array {
  const body = utf8.encode(key);
  const out = new Uint8Array(body.length + (closed ? 2 : 1));
  out[0] = SEP;
  out.set(body, 1);
  if (closed) out[out.length - 1] = SEP;
  return out;
}

function minOf(values: number[]): number {
  let min = Infinity;
  for (const v of values) if (v < min) min = v;
  return min;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}
