/**
 * Which words a search leaves out. Each filter is one entry in FILTERS: a
 * switch (safe search, phrases, names) or a range over a word column (word
 * length). Filters read the index's word columns (docs/index-format.md, "Word
 * columns"), so a new filter is a new entry here, plus a column from the index
 * builder when it needs data the index doesn't have yet. Settings and the
 * Filters panel are drawn from this table; a filter whose data this index
 * lacks isn't offered.
 *
 * A choice of filters compiles to one WordFilter: a bit per word, with counts,
 * which every list, count and position of a search goes through.
 */

import type { HeadwordIndex } from "./headword-index";
import { normalize } from "./normalize";

/** A range filter's choice: [min, max], each inclusive; null means any. */
export type Range = readonly [min: number | null, max: number | null];

/** What each filter is set to, by id. A filter left out is off (a switch) or any (a range). */
export type FilterState = Readonly<Record<string, boolean | Range | undefined>>;

/** Corrections to the index's explicit words (data/safe-search.list), as written ("Banana" or "banana"). */
export interface SafeSearchOverrides {
  /** Hide these too: words the labels missed. */
  block?: readonly string[];
  /** Hide every word containing one of these pieces ("snigger" reads as the slur in it). */
  contains?: readonly string[];
  /** Show these after all: words the labels caught by mistake. Wins over block and contains. */
  allow?: readonly string[];
}

/** What a filter can read. */
export interface FilterContext {
  index: HeadwordIndex;
  overrides: SafeSearchOverrides;
}

interface FilterBase {
  /** Stable name: settings are saved under it. */
  id: string;
  label: string;
  help: string;
}

/** On or off; on leaves words out. Drawn as a switch in Settings. */
export interface SwitchFilter extends FilterBase {
  kind: "switch";
  default: boolean;
  /** The words it leaves out (a bit per word id, as in a "bits" column), or
   *  null when this index lacks the data to tell. */
  hides(context: FilterContext): Uint32Array | null;
}

/** Keeps words whose value in a "u8" word column is within [min, max]. Drawn
 *  as a pair of wheels in the Filters panel. */
export interface RangeFilter extends FilterBase {
  kind: "range";
  column: string;
  /** The smallest value offered. */
  min: number;
}

export type Filter = SwitchFilter | RangeFilter;

export const FILTERS: readonly Filter[] = [
  {
    kind: "switch",
    id: "safe-search",
    label: "Safe search",
    help: "Omits vulgar words and slurs.",
    default: true,
    hides: safeSearchHides,
  },
  {
    kind: "switch",
    id: "phrases",
    label: "Disable phrases",
    help: "Omits entries of more than one word.",
    default: true,
    hides: ({ index }) => wordsWhere(index.column("SHAPE", "u8"), (shape) => shape === 2), // has spaces
  },
  {
    kind: "switch",
    id: "names",
    label: "Disable names",
    help: "Omits names of people, places and things.",
    default: true,
    hides: ({ index }) => index.column("NAME", "bits"),
  },
  {
    kind: "range",
    id: "length",
    label: "Word length",
    help: "Characters in the word.",
    column: "LEN",
    min: 1,
  },
];

/** One string per choice of filters: equal strings, equal choices. */
export function filterKey(state: FilterState = {}): string {
  return JSON.stringify(FILTERS.map((f) => state[f.id] ?? null));
}

/** Every filter on its default: safe search, phrases and names left out, any length. */
export function defaultFilters(): Record<string, boolean | Range> {
  return Object.fromEntries(FILTERS.map((f) => [f.id, f.kind === "switch" ? f.default : [null, null]]));
}

/** A filter this index has the data for, with what the UI needs to draw it. */
export type FilterInfo =
  | { kind: "switch"; id: string; label: string; help: string; default: boolean }
  | { kind: "range"; id: string; label: string; help: string; min: number; max: number };

/**
 * The filters for one index: what it can offer, and a choice of them compiled
 * to a WordFilter. Each filter's words are worked out once and kept.
 */
export class Filters {
  private readonly parts = new Map<string, Uint32Array | null>();
  private compiled: { signature: string; filter: WordFilter | null } | null = null;

  constructor(private readonly context: FilterContext) {}

  /** The filters this index has data for, in FILTERS order. A range's max is
   *  the largest value in its column. */
  available(): FilterInfo[] {
    const out: FilterInfo[] = [];
    for (const f of FILTERS) {
      const { id, label, help } = f;
      if (f.kind === "switch") {
        if (this.part(f, true)) out.push({ kind: "switch", id, label, help, default: f.default });
      } else {
        const column = this.context.index.column(f.column, "u8");
        if (!column) continue;
        let max = f.min;
        for (let i = 0; i < column.length; i++) if (column[i] > max) max = column[i];
        out.push({ kind: "range", id, label, help, min: f.min, max });
      }
    }
    return out;
  }

  /** The words `state` leaves out, or null when it leaves out none. */
  compile(state: FilterState = {}): WordFilter | null {
    const signature = filterKey(state);
    if (this.compiled?.signature === signature) return this.compiled.filter;
    const sets: Uint32Array[] = [];
    for (const f of FILTERS) {
      const value = state[f.id];
      const part = f.kind === "switch" ? this.part(f, value === true) : this.part(f, value);
      if (part) sets.push(part);
    }
    const filter = WordFilter.union(sets, this.context.index.size);
    this.compiled = { signature, filter };
    return filter;
  }

  /** One filter's words at one setting (null: none, or no data). */
  private part(f: Filter, value: boolean | Range | undefined): Uint32Array | null {
    if (f.kind === "switch") {
      if (!value) return null;
      if (!this.parts.has(f.id)) this.parts.set(f.id, f.hides(this.context));
      return this.parts.get(f.id)!;
    }
    if (!Array.isArray(value)) return null;
    const [min, max] = value as Range;
    if (min === null && max === null) return null;
    const key = `${f.id}=${min}-${max}`;
    if (!this.parts.has(key)) {
      const column = this.context.index.column(f.column, "u8");
      const outside = (v: number) => (min !== null && v < min) || (max !== null && v > max);
      this.parts.set(key, wordsWhere(column, outside));
    }
    return this.parts.get(key)!;
  }
}

/** Words whose value in a "u8" column passes `test`, as bits (null without the column). */
function wordsWhere(column: Uint8Array | null, test: (value: number) => boolean): Uint32Array | null {
  if (!column) return null;
  const bits = new Uint32Array((column.length + 31) >>> 5);
  for (let id = 0; id < column.length; id++) if (test(column[id])) bits[id >>> 5] |= 1 << (id & 31);
  return bits;
}

/** Safe search's words: the index's explicit words, plus `block` and every
 *  word containing a piece in `contains`, minus `allow`. Words the index
 *  doesn't have are ignored. */
function safeSearchHides({ index, overrides }: FilterContext): Uint32Array {
  const bits = new Uint32Array((index.size + 31) >>> 5);
  const set = (id: number) => (bits[id >>> 5] |= 1 << (id & 31));
  const lookup = (words: readonly string[] = []) =>
    words.map((w) => index.exact(normalize(w))).filter((id): id is number => id !== null);
  for (const id of index.explicitIds()) set(id);
  for (const id of lookup(overrides.block)) set(id);
  for (const piece of overrides.contains ?? []) {
    const key = normalize(piece);
    if (key) for (const id of index.wordsContaining(key)) set(id);
  }
  for (const id of lookup(overrides.allow)) bits[id >>> 5] &= ~(1 << (id & 31));
  return bits;
}

/** Set bits in a 32-bit number. */
function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}

/** Word ids a search leaves out: a bit per word, with a running count so the
 *  hidden words in any id range are counted at once. */
export class WordFilter {
  private constructor(
    private readonly bits: Uint32Array,
    /** before[w] = hidden ids below 32 * w */
    private readonly before: Uint32Array,
  ) {}

  /** The words any of `sets` leaves out, or null when that's none. */
  static union(sets: readonly Uint32Array[], size: number): WordFilter | null {
    const bits = new Uint32Array((size + 31) >>> 5);
    for (const set of sets) for (let w = 0; w < bits.length; w++) bits[w] |= set[w];
    const before = new Uint32Array(bits.length + 1);
    for (let w = 0; w < bits.length; w++) before[w + 1] = before[w] + popcount(bits[w]);
    return before[bits.length] === 0 ? null : new WordFilter(bits, before);
  }

  /** True for a word the search leaves out. */
  has(id: number): boolean {
    return (this.bits[id >>> 5] & (1 << (id & 31))) !== 0;
  }

  /** Hidden words with ids in [lo, hi). */
  countIn(lo: number, hi: number): number {
    return this.rank(hi) - this.rank(lo);
  }

  /** Hidden words with ids below `id`. */
  private rank(id: number): number {
    const w = id >>> 5;
    const low = (1 << (id & 31)) - 1; // bits below id in its word (none when id % 32 is 0)
    return this.before[w] + (w < this.bits.length ? popcount(this.bits[w] & low) : 0);
  }
}
