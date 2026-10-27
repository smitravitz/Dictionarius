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
}

export class HeadwordIndex {
  private constructor(
    readonly size: number,
    private readonly n: number,
    private readonly blockShift: number,
    private readonly superShift: number,
    private readonly s: Sections,
  ) {}

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

    return new HeadwordIndex(numWords, n, u32(24), u32(28), {
      C: view("C", Uint32Array),
      bwt: view("BWT", Uint8Array),
      denseOf,
      sparseOf,
      numDense,
      superRank: view("SUPER", Uint32Array),
      blockRank: view("BLOCK", Uint16Array),
      sparseOffsets: view("SOFF", Uint32Array),
      sparsePositions: view("SPOS", Uint32Array),
      freq: u32(12) & FLAG_FREQ ? view("FREQ", Uint16Array) : null,
      variantIds: view("VIDS", Uint32Array),
      variantOffsets: view("VOFF", Uint32Array),
      variantBlob: view("VBLOB", Uint8Array),
    });
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

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}
