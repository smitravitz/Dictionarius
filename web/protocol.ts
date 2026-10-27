import type { Suggestion } from "../src/complete";

/** Results per page: the first screen, and each lazy load after it. */
export const PAGE_SIZE = 50;

/** Messages from the page to the search worker. */
export type ToWorker =
  | { type: "load"; url: string }
  | { type: "search"; seq: number; query: string }
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
      items: Suggestion[];
      done: boolean;
      prefixCount: number;
      occurrences: number;
    };
