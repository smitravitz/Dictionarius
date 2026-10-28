import type { HeadwordIndex, OffsetWalk } from "./headword-index";
import { normalize } from "./normalize";
import { Filters, type FilterInfo, type FilterState, type SafeSearchOverrides, type WordFilter } from "./filters";

export type { SafeSearchOverrides } from "./filters";

/**
 * Type-ahead results, produced lazily, a page at a time.
 *
 * Order: the exact match first. Then words by how many characters come before
 * the (first) match: every word that starts with the query, then words with
 * one character in front of it, then two, and so on. Within one position:
 * single words, then hyphenated words, then entries with spaces; then common
 * words first; then alphabetical.
 *
 * Positions are worked out on demand (see HeadwordIndex.offsetWalk), so the
 * first page never waits for words deep inside long ones.
 *
 * Safe search leaves out explicit words (vulgar, offensive, slurs: see
 * docs/index-format.md), except the exact match: a word typed out in full
 * still shows. Counts cover only what is shown. The index's list can be tuned
 * without rebuilding it: `block` hides more words, `allow` shows some again.
 */

export interface Suggestion {
  id: number;
  /** normalized search key */
  key: string;
  /** how to show it (first display form) */
  display: string;
  /** all ways the word is written, e.g. ["resume", "résumé"] */
  forms: string[];
  /** characters before the match (0 = the word starts with the query) */
  offset: number;
  /** the word is exactly the query */
  exact: boolean;
  /** Zipf scale; 0 = unknown */
  frequency: number;
}

/** Rank points per shape step. Above any score (Zipf tops out near 8 = 800
 *  points), so shape always decides before frequency. */
const SHAPE_STEP = 2000;
const MAX_SCORE = SHAPE_STEP - 1;
/** Chunks smaller than this are sorted directly; bigger ones by counting sort. */
const SMALL_CHUNK = 256;

export interface SearchOptions {
  /** Words to leave out (src/filters.ts), even one typed out in full. */
  filters?: FilterState;
}

export class Completer {
  /** Per id: (2 - shape) x SHAPE_STEP + score; higher ranks first. */
  private readonly ranks: Uint16Array;
  private readonly maxRank: number;
  private readonly filters: Filters;

  constructor(
    private readonly index: HeadwordIndex,
    overrides: SafeSearchOverrides = {},
  ) {
    this.filters = new Filters({ index, overrides });
    const k = index.size;
    this.ranks = new Uint16Array(k);
    let maxRank = 0;
    for (let id = 0; id < k; id++) {
      const score = Math.min(MAX_SCORE, Math.round(index.frequency(id) * 100));
      const rank = (2 - index.shape(id)) * SHAPE_STEP + score;
      this.ranks[id] = rank;
      if (rank > maxRank) maxRank = rank;
    }
    this.maxRank = maxRank;
  }

  /** All matches for what the user typed. Cheap to create; work happens as
   *  cursors and counts ask for it. */
  search(typed: string, options: SearchOptions = {}): Matches {
    const query = normalize(typed);
    // Separator bytes would match word boundaries; a normalized query has none.
    const exactId = query && !/[\u0000\u0001]/.test(query) ? this.index.exact(query) : null;
    const filter = this.filters.compile(options.filters);
    return new Matches(this.index, this.ranks, this.maxRank, query, exactId, filter);
  }

  /** Work out which words `filters` leaves out now rather than on the next
   *  search (the first time a filter is used: tens of milliseconds). */
  prepare(filters: FilterState): void {
    this.filters.compile(filters);
  }

  /** The filters this index has the data for (src/filters.ts). */
  availableFilters(): FilterInfo[] {
    return this.filters.available();
  }
}

export class Matches {
  /** Words that start with the query (the exact match included). */
  readonly starts: number;
  /** Words that end with the query; with filters, null until `complete`
   *  (they are counted as the positions are worked out). */
  get ends(): number | null {
    if (!this.filter) return this.endsNow;
    return this.complete ? this.endsCounted : null;
  }
  /** Times the query occurs inside headwords; an upper bound on `total`. */
  readonly occurrences: number;

  private readonly walk: OffsetWalk | null;
  /** Finished positions: word ids in rank order, each word at its first match. */
  private readonly chunks: Uint32Array[] = [];
  private seen: Uint32Array | null = null; // bitset: word already placed in a chunk
  private rankCounts: Uint32Array | null = null;
  /** Words ending with the query, all of them (exact, at once). */
  private readonly endsNow: number;
  /** With filters: shown words found ending with the query so far. */
  private endsCounted = 0;
  /** The query's length in characters, as LEN counts them. */
  private readonly queryLength: number;
  /** Characters per word (the LEN column), to count ends as positions are worked out. */
  private readonly lengths: Uint8Array | null;

  constructor(
    private readonly index: HeadwordIndex,
    private readonly ranks: Uint16Array,
    private readonly maxRank: number,
    /** the normalized query */
    readonly query: string,
    private readonly exactId: number | null,
    /** the words left out, or null when none are */
    private readonly filter: WordFilter | null,
  ) {
    // Separator bytes would match word boundaries; a normalized query has none.
    const usable = query !== "" && !/[\u0000\u0001]/.test(query);
    const { start, count } = usable ? index.prefix(query) : { start: 0, count: 0 };
    this.starts = count - (filter && count ? filter.countIn(start, start + count) : 0);
    this.endsNow = usable ? index.countEndingWith(query) : 0;
    this.queryLength = Array.from(query).length;
    this.lengths = filter ? index.column("LEN", "u8") : null;
    this.occurrences = usable ? index.countOccurrences(query) : 0;
    this.walk = usable && this.occurrences > 0 ? index.offsetWalk(query) : null;
  }

  /** Words found at each position so far: byOffset[n] = words with n
   *  characters before their first match. Grows as positions are worked out. */
  get byOffset(): readonly number[] {
    const sizes = this.chunks.map((c) => c.length);
    // A word holding the query twice is also found at its later position; when
    // nothing else is there, the last positions end up empty. Drop them.
    if (this.complete) while (sizes.length > 0 && sizes[sizes.length - 1] === 0) sizes.pop();
    return sizes;
  }

  /** True once every position has been worked out. */
  get complete(): boolean {
    return !this.walk || (this.walk.finished && this.chunks.length > this.walk.maxOffset);
  }

  /** True when filters leave words out of this search. */
  get filtered(): boolean {
    return this.filter !== null;
  }

  /** Words containing the query, once `complete`; null until then. */
  get total(): number | null {
    if (!this.complete) return null;
    let sum = 0;
    for (const c of this.chunks) sum += c.length;
    return sum;
  }

  /** Work out more positions without listing them, using about `budget`
   *  units of work. Returns true once complete. */
  count(budget: number): boolean {
    let left = budget;
    while (!this.complete && left > 0) {
      left -= Math.max(1, this.walk!.step(left));
      this.settle();
    }
    return this.complete;
  }

  /** Results from `fromOffset` characters before the match onwards (the exact
   *  match comes first only from 0). Several cursors can share one search. */
  cursor(fromOffset = 0): ResultCursor {
    return new ResultCursor(this, fromOffset);
  }

  /** Rows worked out so far: the list is at least this long. Equals `total`
   *  once complete. */
  get known(): number {
    let sum = 0;
    for (const c of this.chunks) sum += c.length;
    return sum;
  }

  /**
   * Rows [from, to) of the whole list (the exact match, then words by
   * position): any stretch, read directly. Positions up to `to` are worked out
   * if needed. Fewer rows (or none) come back past the end of the list.
   */
  rows(from: number, to: number): Suggestion[] {
    const out: Suggestion[] = [];
    let base = 0; // row where position `offset` starts
    for (let offset = 0; base < to; offset++) {
      const ids = this.chunk(offset);
      if (!ids) break;
      for (let row = Math.max(from, base); row < Math.min(to, base + ids.length); row++) {
        out.push(this.suggestion(ids[row - base], offset));
      }
      base += ids.length;
    }
    return out;
  }

  /** The row where words with `offset` characters before the match begin (the
   *  length of the list, if no word has that many). */
  startOf(offset: number): number {
    let row = 0;
    for (let k = 0; k < offset; k++) {
      const ids = this.chunk(k);
      if (!ids) break;
      row += ids.length;
    }
    return row;
  }

  /** Ranked word ids of position `offset`, working it out if needed; null when
   *  there is no such position (past the last word). */
  chunk(offset: number): Uint32Array | null {
    while (this.chunks.length <= offset && !this.complete) {
      this.walk!.step(Infinity); // one level of the walk
      this.settle();
    }
    return this.chunks[offset] ?? null;
  }

  /** @internal */
  suggestion(id: number, offset: number): Suggestion {
    const forms = this.index.displayForms(id);
    return {
      id,
      key: this.index.key(id),
      display: forms[0],
      forms,
      offset,
      exact: id === this.exactId,
      frequency: this.index.frequency(id),
    };
  }

  /** Turn every position the walk has settled into a ranked chunk. */
  private settle() {
    const walk = this.walk!;
    const last = Math.min(walk.settled, walk.maxOffset + 1);
    while (this.chunks.length < last) this.chunks.push(this.buildChunk(this.chunks.length));
  }

  /** Words first found at `offset`: the walk's ids minus words already placed
   *  at a smaller offset, in rank order (rank desc, then id asc). */
  private buildChunk(offset: number): Uint32Array {
    const seen = (this.seen ??= new Uint32Array((this.index.size + 31) >>> 5));
    const { ranges, singles } = this.walk!.idsAt(offset);
    const ids: number[] = [];
    const { filter, lengths } = this;
    const end = offset + this.queryLength; // a word this long ends with the query found here
    const take = (id: number) => {
      if (filter?.has(id)) return;
      if (lengths && lengths[id] === end) this.endsCounted++;
      const bit = 1 << (id & 31);
      if (seen[id >>> 5] & bit) return;
      seen[id >>> 5] |= bit;
      ids.push(id);
    };
    for (let i = 0; i < ranges.length; i += 2) for (let id = ranges[i]; id < ranges[i + 1]; id++) take(id);
    for (const id of singles) take(id);

    const sorted = this.rank(Uint32Array.from(ids).sort()); // ascending ids: ties stay alphabetical
    // The exact match leads the list.
    const exact = offset === 0 && this.exactId !== null ? sorted.indexOf(this.exactId) : -1;
    if (exact > 0) {
      sorted.copyWithin(1, 0, exact);
      sorted[0] = this.exactId!;
    }
    return sorted;
  }

  /** Ids (ascending) in rank order: rank desc, then id asc. */
  private rank(out: Uint32Array): Uint32Array {
    const { ranks, maxRank } = this;
    if (out.length < SMALL_CHUNK) {
      return out.sort((a, b) => ranks[b] - ranks[a] || a - b);
    }
    // Counting sort by rank, highest first; stable, so ids stay ascending.
    const starts = (this.rankCounts ??= new Uint32Array(maxRank + 2));
    starts.fill(0);
    for (const id of out) starts[maxRank - ranks[id] + 1]++;
    for (let r = 1; r < starts.length; r++) starts[r] += starts[r - 1];
    const sorted = new Uint32Array(out.length);
    for (const id of out) sorted[starts[maxRank - ranks[id]]++] = id;
    return sorted;
  }
}

/** Reads the list in order from a starting position, a page at a time. */
export class ResultCursor {
  private pos: number | null = null; // row of the next result; found on first use
  private finished = false;

  constructor(
    private readonly matches: Matches,
    /** where this cursor started: characters before the match */
    readonly fromOffset: number,
  ) {}

  get query(): string {
    return this.matches.query;
  }

  /** True once every match from `fromOffset` on has been returned. */
  get done(): boolean {
    return this.finished;
  }

  /** Up to `n` more results. */
  next(n: number): Suggestion[] {
    if (this.finished) return [];
    this.pos ??= this.matches.startOf(this.fromOffset);
    const out = this.matches.rows(this.pos, this.pos + n);
    this.pos += out.length;
    if (out.length < n) this.finished = true;
    return out;
  }
}
