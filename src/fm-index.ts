/**
 * Self-contained FM-index: substring search over a compressed-friendly BWT,
 * with backward search (count) and locate (positions). Zero dependencies.
 *
 * This is a correctness-first implementation (full suffix array kept in memory
 * for locate). The size-optimized shipping build — RRR/wavelet-tree rank and a
 * sampled suffix array, or a wasm succinct library — is a separate concern; the
 * BEHAVIOR proven here is identical to what that build must reproduce.
 */

const TERM = 0; // unique terminator, smallest
const SEP = 1; // word separator, second-smallest (never in normalized text)

/** Prefix-doubling suffix array over an array of small non-negative ints. O(n log^2 n). */
function buildSuffixArray(s: Int32Array): Int32Array {
  const n = s.length;
  const sa = new Int32Array(n);
  let rank = new Int32Array(n);
  const tmp = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    sa[i] = i;
    rank[i] = s[i];
  }
  for (let k = 1; k < n; k <<= 1) {
    const cmp = (a: number, b: number): number => {
      if (rank[a] !== rank[b]) return rank[a] - rank[b];
      const ra = a + k < n ? rank[a + k] : -1;
      const rb = b + k < n ? rank[b + k] : -1;
      return ra - rb;
    };
    const arr = Array.from(sa);
    arr.sort(cmp);
    for (let i = 0; i < n; i++) sa[i] = arr[i];
    tmp[sa[0]] = 0;
    for (let i = 1; i < n; i++) tmp[sa[i]] = tmp[sa[i - 1]] + (cmp(sa[i - 1], sa[i]) < 0 ? 1 : 0);
    rank = Int32Array.from(tmp);
    if (rank[sa[n - 1]] === n - 1) break;
  }
  return sa;
}

export class FmIndex {
  private readonly n: number;
  private readonly sa: Int32Array;
  private readonly bwt: Int32Array;
  private readonly C: Map<number, number>; // symbol -> first-column start
  private readonly occ: Map<number, Int32Array>; // symbol -> prefix counts (len n+1)

  constructor(text: Int32Array) {
    this.n = text.length;
    this.sa = buildSuffixArray(text);
    this.bwt = new Int32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const p = this.sa[i];
      this.bwt[i] = text[(p - 1 + this.n) % this.n];
    }
    // alphabet + counts
    const counts = new Map<number, number>();
    for (let i = 0; i < this.n; i++) counts.set(this.bwt[i], (counts.get(this.bwt[i]) ?? 0) + 1);
    const alpha = [...counts.keys()].sort((a, b) => a - b);
    this.C = new Map();
    let run = 0;
    for (const c of alpha) {
      this.C.set(c, run);
      run += counts.get(c)!;
    }
    // full occ tables (correctness-first; the shipping build replaces these
    // with checkpoints + wavelet tree)
    this.occ = new Map();
    for (const c of alpha) this.occ.set(c, new Int32Array(this.n + 1));
    for (let i = 0; i < this.n; i++) {
      for (const c of alpha) this.occ.get(c)![i + 1] = this.occ.get(c)![i];
      const b = this.bwt[i];
      this.occ.get(b)![i + 1] = this.occ.get(b)![i] + 1;
    }
  }

  /** Backward search → half-open SA range [l, r) for `pattern`, or null. */
  private range(pattern: Int32Array): [number, number] | null {
    let l = 0;
    let r = this.n;
    for (let i = pattern.length - 1; i >= 0; i--) {
      const c = pattern[i];
      const cStart = this.C.get(c);
      const occC = this.occ.get(c);
      if (cStart === undefined || occC === undefined) return null;
      l = cStart + occC[l];
      r = cStart + occC[r];
      if (l >= r) return null;
    }
    return [l, r];
  }

  /** Number of occurrences of `pattern` in the text. */
  count(pattern: Int32Array): number {
    const rg = this.range(pattern);
    return rg ? rg[1] - rg[0] : 0;
  }

  /** Text positions where `pattern` occurs. */
  locate(pattern: Int32Array): number[] {
    const rg = this.range(pattern);
    if (!rg) return [];
    const out: number[] = [];
    for (let i = rg[0]; i < rg[1]; i++) out.push(this.sa[i]);
    return out;
  }
}

export { TERM, SEP };
