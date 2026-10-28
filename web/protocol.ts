import type { Suggestion } from "../src/complete";
import type { FilterInfo, FilterState } from "../src/filters";

/** Results per page: the first screen, and each lazy load after it. */
export const PAGE_SIZE = 50;

/** How many words match, as far as the worker has counted. */
export interface Counts {
  /** words starting with the query */
  starts: number;
  /** words ending with it; with filters, null until every position has been counted */
  ends: number | null;
  /** times it occurs inside headwords (an upper bound on the total) */
  occurrences: number;
  /** byOffset[n] = words with n letters before their first match, so far */
  byOffset: number[];
  /** words containing it; null until every position has been counted */
  total: number | null;
  /** filterKey() of the filters it was counted with */
  filters: string;
  /** filters left words out */
  filtered: boolean;
}

/** Messages from the page to the search worker. */
export type ToWorker =
  | { type: "load"; url: string }
  /** Which words to leave out (src/filters.ts); the next search uses them. */
  | { type: "settings"; filters: FilterState }
  /** A new search: answered with its first page of rows. */
  | { type: "search"; seq: number; query: string }
  /** Rows [from, to) of the current search. */
  | { type: "rows"; seq: number; from: number; to: number }
  /** Where words with `offset` letters before the query start, with a page of rows from there. */
  | { type: "seek"; seq: number; offset: number };

/** Messages from the search worker to the page. `seq` ties an answer to the
 *  search that asked for it, so answers to outdated searches are dropped. */
export type FromWorker =
  /** The index loaded; `filters` are the ones it has the data for. */
  | { type: "ready"; words: number; ms: number; filters: FilterInfo[] }
  | { type: "failed"; message: string }
  | {
      type: "rows";
      seq: number;
      query: string;
      /** row of the first item */
      from: number;
      items: Suggestion[];
      /** the list is at least this long… */
      known: number;
      /** …and exactly that long when complete */
      complete: boolean;
      counts: Counts;
      /** set when answering a seek */
      seek?: { offset: number; row: number };
    }
  /** Counting finished in the background (for the query in `query`). */
  | { type: "counts"; query: string; counts: Counts };
