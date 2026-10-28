import type { Suggestion } from "../src/complete";

/** Results per page: the first screen, and each lazy load after it. */
export const PAGE_SIZE = 50;

/** How many words match, as far as the worker has counted. */
export interface Counts {
  /** words starting with the query */
  starts: number;
  /** words ending with it */
  ends: number;
  /** times it occurs inside headwords (an upper bound on the total) */
  occurrences: number;
  /** byOffset[n] = words with n letters before their first match, so far */
  byOffset: number[];
  /** words containing it; null until every position has been counted */
  total: number | null;
}

/** Messages from the page to the search worker. */
export type ToWorker =
  | { type: "load"; url: string }
  /** List matches with at least `fromOffset` letters before the query. */
  | { type: "search"; seq: number; query: string; fromOffset: number }
  | { type: "more"; seq: number };

/** Messages from the search worker to the page. `seq` ties a page to the
 *  search that asked for it, so answers to outdated searches are dropped. */
export type FromWorker =
  | { type: "ready"; words: number; ms: number }
  | { type: "failed"; message: string }
  | {
      type: "page";
      seq: number;
      query: string;
      fromOffset: number;
      items: Suggestion[];
      done: boolean;
      counts: Counts;
    }
  /** Counting finished in the background (for the query in `query`). */
  | { type: "counts"; query: string; counts: Counts };
