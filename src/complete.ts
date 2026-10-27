import type { HeadwordIndex } from "./headword-index";
import { normalize } from "./normalize";

/**
 * Type-ahead results, ranked and produced lazily, a page at a time.
 *
 * Order: the exact match, then words starting with the query, then words
 * containing it mid-word. Within each tier: most frequent first, ties
 * alphabetical (= word id order). Asking for the next page never enumerates
 * the whole result set, so a 1-letter query costs the same as a 6-letter one.
 */

export type Tier = "exact" | "prefix" | "midword";

export interface Suggestion {
  id: number;
  /** normalized search key */
  key: string;
  /** how to show it (first display form) */
  display: string;
  /** all ways the word is written, e.g. ["resume", "résumé"] */
  forms: string[];
  tier: Tier;
  /** Zipf scale; 0 = unknown */
  frequency: number;
}

export interface CompleterOptions {
  /** Mid-word sets with at most this many occurrences are located in full and
   *  sorted; larger ones are scanned in frequency order, which stops early. */
  locateLimit: number;
  /** Max words examined per next() call while scanning, so no call stalls.
   *  A page can come back short with done = false; just ask again. */
  scanBudget: number;
  /** Search the index's hot list (top-ranked words as one string) first, so
   *  mid-word results for common fragments are instant. */
  useHot: boolean;
}

const DEFAULTS: CompleterOptions = { locateLimit: 10_000, scanBudget: 20_000, useHot: true };
const BLOCK_SHIFT = 5; // 32 ids per tree leaf

/** Frequency ranks + a max tree over blocks of ids, shared by all cursors. */
interface Ranks {
  freq: Uint16Array; // rank score x 100 per id
  tree: Uint16Array; // tree[1] = root; leaves at [leafBase, leafBase + numBlocks)
  leafBase: number;
}

/** The index's hot list, with each entry's word id and start offset. */
interface Hot {
  text: string; // keys in rank order, each followed by "\u0001"
  ids: Uint32Array; // entry i -> word id
  starts: Uint32Array; // entry i -> offset in text
  /** True for the words in the hot list (the top `count` in rank order). */
  contains(id: number): boolean;
}

export class Completer {
  private readonly ranks: Ranks;
  private readonly hot: Hot | null;
  private readonly options: CompleterOptions;

  constructor(
    private readonly index: HeadwordIndex,
    options: Partial<CompleterOptions> = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
    const k = index.size;
    const freq = new Uint16Array(k);
    for (let id = 0; id < k; id++) freq[id] = Math.round(index.frequency(id) * 100);

    const numBlocks = (k + (1 << BLOCK_SHIFT) - 1) >>> BLOCK_SHIFT;
    let leafBase = 1;
    while (leafBase < numBlocks) leafBase <<= 1;
    const tree = new Uint16Array(2 * leafBase);
    for (let id = 0; id < k; id++) {
      const leaf = leafBase + (id >>> BLOCK_SHIFT);
      if (freq[id] > tree[leaf]) tree[leaf] = freq[id];
    }
    for (let i = leafBase - 1; i >= 1; i--) tree[i] = Math.max(tree[2 * i], tree[2 * i + 1]);
    this.ranks = { freq, tree, leafBase };
    this.hot = this.options.useHot ? loadHot(index, freq) : null;
  }

  /** Start a ranked, lazily paged search for what the user typed. */
  complete(typed: string): ResultCursor {
    return new ResultCursor(this.index, this.ranks, this.hot, this.options, normalize(typed));
  }
}

/**
 * Pair the hot list's entries with word ids. The list holds the top-ranked
 * words in rank order, so its ids are the first `hotCount` ids of the rank
 * order, rebuilt here with one counting-sort pass over the scores.
 * Returns null (search still works, just without the fast path) if the file
 * has no hot list or it doesn't line up with the scores.
 */
function loadHot(index: HeadwordIndex, freq: Uint16Array): Hot | null {
  const count = index.hotCount;
  if (count === 0) return null;

  let maxScore = 0;
  for (let id = 0; id < freq.length; id++) if (freq[id] > maxScore) maxScore = freq[id];
  const perScore = new Uint32Array(maxScore + 1);
  for (let id = 0; id < freq.length; id++) perScore[freq[id]]++;
  const next = new Uint32Array(maxScore + 1); // next rank position per score, high scores first
  for (let score = maxScore, pos = 0; score >= 0; score--) {
    next[score] = pos;
    pos += perScore[score];
  }
  const ids = new Uint32Array(count);
  for (let id = 0; id < freq.length; id++) {
    const rank = next[freq[id]]++;
    if (rank < count) ids[rank] = id;
  }

  const text = index.hotText();
  const starts = new Uint32Array(count);
  let entries = 0;
  for (let at = 0; at < text.length; at = text.indexOf("\u0001", at) + 1) {
    if (entries === count) return null; // more entries than declared
    starts[entries++] = at;
  }
  if (entries !== count) return null;
  // Spot-check that entries and ids agree at both ends.
  const keyOf = (entry: number) =>
    text.slice(starts[entry], entry + 1 < count ? starts[entry + 1] - 1 : text.length - 1);
  if (keyOf(0) !== index.key(ids[0]) || keyOf(count - 1) !== index.key(ids[count - 1])) return null;

  const lastId = ids[count - 1];
  const lastScore = freq[lastId];
  return {
    text,
    ids,
    starts,
    contains: (id) => freq[id] > lastScore || (freq[id] === lastScore && id <= lastId),
  };
}

/**
 * Mid-word matches come in two ranked runs: those in the hot list (found by
 * string search, instant), then the rest (all ranked below every hot word),
 * found by locating every occurrence (small sets) or a budgeted scan in rank
 * order (large sets).
 */
const enum Stage {
  Exact,
  Prefix,
  MidwordStart,
  MidwordHot,
  MidwordRest,
  MidwordList,
  MidwordScan,
  Done,
}

export class ResultCursor {
  /** How many words start with the query (exact match included). */
  readonly prefixCount: number;
  /** How many times the query occurs anywhere inside headwords. */
  readonly occurrences: number;

  private stage: Stage;
  private readonly exactId: number | null;
  private readonly prefixStart: number;
  private readonly prefix: RankedIds | null;
  private midwordList: number[] = [];
  private midwordPos = 0;
  private midwordScan: RankedIds | null = null;
  private hotFrom = 0; // where the next hot-list search starts

  constructor(
    private readonly index: HeadwordIndex,
    private readonly ranks: Ranks,
    private readonly hot: Hot | null,
    private readonly options: CompleterOptions,
    /** the normalized query */
    readonly query: string,
  ) {
    if (query === "") {
      this.stage = Stage.Done;
      this.exactId = null;
      this.prefixStart = this.prefixCount = this.occurrences = 0;
      this.prefix = null;
      return;
    }
    const { start, count } = index.prefix(query);
    this.prefixStart = start;
    this.prefixCount = count;
    this.occurrences = index.countOccurrences(query);
    this.exactId = index.exact(query);
    // The exact key sorts first among words that start with it.
    const from = this.exactId === null ? start : start + 1;
    this.prefix = new RankedIds(ranks, from, start + count);
    this.stage = Stage.Exact;
  }

  /** True once every match has been returned. */
  get done(): boolean {
    return this.stage === Stage.Done;
  }

  /** Up to `n` more results. May return fewer (even none) before `done` when a
   *  large mid-word scan hits its work budget; call again to continue. */
  next(n: number): Suggestion[] {
    const out: Suggestion[] = [];
    let budget = this.options.scanBudget;
    while (out.length < n && this.stage !== Stage.Done) {
      switch (this.stage) {
        case Stage.Exact:
          if (this.exactId !== null) out.push(this.suggestion(this.exactId, "exact"));
          this.stage = Stage.Prefix;
          break;

        case Stage.Prefix: {
          const id = this.prefix!.next();
          if (id < 0) this.stage = Stage.MidwordStart;
          else out.push(this.suggestion(id, "prefix"));
          break;
        }

        case Stage.MidwordStart:
          if (this.occurrences === 0) this.stage = Stage.Done;
          else this.stage = this.hot ? Stage.MidwordHot : Stage.MidwordRest;
          break;

        case Stage.MidwordHot: {
          const hot = this.hot!;
          const at = hot.text.indexOf(this.query, this.hotFrom);
          if (at < 0) {
            this.stage = hot.ids.length < this.index.size ? Stage.MidwordRest : Stage.Done;
            break;
          }
          const entry = lastAtOrBefore(hot.starts, at);
          // Resume after this word, so a word matching twice appears once.
          this.hotFrom = entry + 1 < hot.starts.length ? hot.starts[entry + 1] : hot.text.length;
          const id = hot.ids[entry];
          if (!this.isPrefixMatch(id)) out.push(this.suggestion(id, "midword"));
          break;
        }

        case Stage.MidwordRest:
          if (this.occurrences <= this.options.locateLimit) {
            const { freq } = this.ranks;
            this.midwordList = this.index
              .wordsContaining(this.query)
              .filter((id) => !this.isPrefixMatch(id) && !this.hot?.contains(id))
              .sort((a, b) => freq[b] - freq[a] || a - b);
            this.stage = Stage.MidwordList;
          } else {
            this.midwordScan = new RankedIds(this.ranks, 0, this.index.size);
            this.stage = Stage.MidwordScan;
          }
          break;

        case Stage.MidwordList:
          if (this.midwordPos < this.midwordList.length) {
            out.push(this.suggestion(this.midwordList[this.midwordPos++], "midword"));
          } else {
            this.stage = Stage.Done;
          }
          break;

        case Stage.MidwordScan: {
          if (budget-- <= 0) return out; // yield; the caller asks again
          const id = this.midwordScan!.next();
          if (id < 0) this.stage = Stage.Done;
          else if (
            !this.isPrefixMatch(id) &&
            !this.hot?.contains(id) && // already returned from the hot list
            this.index.key(id).includes(this.query)
          ) {
            out.push(this.suggestion(id, "midword"));
          }
          break;
        }
      }
    }
    return out;
  }

  private isPrefixMatch(id: number): boolean {
    return id >= this.prefixStart && id < this.prefixStart + this.prefixCount;
  }

  private suggestion(id: number, tier: Tier): Suggestion {
    const forms = this.index.displayForms(id);
    return {
      id,
      key: this.index.key(id),
      display: forms[0],
      forms,
      tier,
      frequency: this.ranks.freq[id] / 100,
    };
  }
}

/**
 * Ids in [lo, hi) in rank order (frequency desc, id asc), produced lazily by a
 * best-first walk of the max tree: a node's max frequency and first id bound
 * every id below it, so popping the best entry always yields the next id.
 */
class RankedIds {
  private readonly heap = new EntryHeap();

  constructor(
    private readonly ranks: Ranks,
    lo: number,
    hi: number,
  ) {
    const size = 1 << BLOCK_SHIFT;
    const firstFull = Math.ceil(lo / size);
    const endFull = Math.floor(hi / size);
    if (firstFull >= endFull) {
      for (let id = lo; id < hi; id++) this.pushId(id);
      return;
    }
    for (let id = lo; id < firstFull * size; id++) this.pushId(id);
    for (let id = endFull * size; id < hi; id++) this.pushId(id);
    // Canonical cover of the full blocks [firstFull, endFull) by tree nodes.
    let l = firstFull + ranks.leafBase;
    let r = endFull + ranks.leafBase;
    for (let level = 0; l < r; level++, l >>= 1, r >>= 1) {
      if (l & 1) this.pushNode(l++, level);
      if (r & 1) this.pushNode(--r, level);
    }
  }

  /** Next id in rank order, or -1 when exhausted. */
  next(): number {
    const { tree } = this.ranks;
    for (;;) {
      const e = this.heap.pop();
      if (!e) return -1;
      if (e.node === 0) return e.first;
      if (e.level === 0) {
        for (let id = e.first; id < e.first + (1 << BLOCK_SHIFT); id++) this.pushId(id);
      } else {
        const half = (1 << (e.level - 1)) << BLOCK_SHIFT;
        this.heap.push({ score: tree[2 * e.node], first: e.first, node: 2 * e.node, level: e.level - 1 });
        this.heap.push({ score: tree[2 * e.node + 1], first: e.first + half, node: 2 * e.node + 1, level: e.level - 1 });
      }
    }
  }

  private pushId(id: number) {
    this.heap.push({ score: this.ranks.freq[id], first: id, node: 0, level: 0 });
  }

  private pushNode(node: number, level: number) {
    const firstBlock = (node << level) - this.ranks.leafBase;
    this.heap.push({ score: this.ranks.tree[node], first: firstBlock << BLOCK_SHIFT, node, level });
  }
}

/** Index of the last value <= `x` in an ascending array (values[0] must be <= x). */
function lastAtOrBefore(values: Uint32Array, x: number): number {
  let lo = 0;
  let hi = values.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** node 0 = a single id (`first`); otherwise a tree node covering ids from `first`. */
interface Entry {
  score: number;
  first: number;
  node: number;
  level: number;
}

/** Binary heap: highest score first, then lowest first id. */
class EntryHeap {
  private readonly items: Entry[] = [];

  push(e: Entry) {
    const a = this.items;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >>> 1;
      if (!before(a[i], a[parent])) break;
      [a[i], a[parent]] = [a[parent], a[i]];
      i = parent;
    }
  }

  pop(): Entry | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        if (l < a.length && before(a[l], a[best])) best = l;
        if (r < a.length && before(a[r], a[best])) best = r;
        if (best === i) break;
        [a[i], a[best]] = [a[best], a[i]];
        i = best;
      }
    }
    return top;
  }
}

function before(x: Entry, y: Entry): boolean {
  return x.score > y.score || (x.score === y.score && x.first < y.first);
}
