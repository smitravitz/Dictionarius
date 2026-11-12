import type { Counts, Suggestion } from "../src/complete";

export type { Counts };
import type { FilterInfo, FilterState } from "../src/filters";
import type { Definition } from "../src/definitions";

/** Results per page: the first screen, and each lazy load after it. */
export const PAGE_SIZE = 50;

/** Messages from the page to the search worker. */
export type ToWorker =
  /** Load the index from `url`, and the definitions beside it, read a block at a time. In a
   *  `browser`: the starter first (the page shows from it), then the word list in the
   *  background, the definitions straight away. In the `app`: the word list (on the
   *  phone, in a moment), the definitions once the start screen has settled. */
  | { type: "load"; url: string; definitions: string; where: "browser" | "app" }
  /** A word's definitions, by word id (answered by "definitions" with the same `ask`). */
  | { type: "definitions"; ask: number; id: number }
  /** The word a text names exactly, for a link (answered by "word" with the same `ask`). */
  | { type: "word"; ask: number; text: string }
  /** Which words to leave out (src/filters.ts); the next search uses them. */
  | { type: "settings"; filters: FilterState }
  /** A new search: answered with its first page of rows. */
  /** `land`: a suggestion's search. Count every word first, then answer with the rows
   *  around where its list opens (src/landing.ts) instead of the first page. */
  | { type: "search"; seq: number; query: string; land?: boolean }
  /** Rows [from, to) of the current search. */
  | { type: "rows"; seq: number; from: number; to: number }
  /** Where words with `offset` letters before the query start, with a page of rows from there. */
  | { type: "seek"; seq: number; offset: number };

/** Messages from the search worker to the page. `seq` ties an answer to the
 *  search that asked for it, so answers to outdated searches are dropped. */
export type FromWorker =
  /** A browser's starter is in (src/starter.ts): the app can show, its suggestions open,
   *  before the word list is in. `filters` are the ones the word list has the data for. */
  | {
      type: "starter";
      words: number;
      filters: FilterInfo[];
      /** the data files to keep on the device (web/data-worker.ts), by versioned address
       *  and size; and the starter's own address, kept too */
      keep: { url: string; bytes: number }[];
      alsoKeep: string[];
    }
  /** How much of the word list has arrived, 0 to 1 (a browser, while it comes). */
  | { type: "progress"; share: number }
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
      /** set when answering a suggestion's search: the row its list opens at (counts are complete) */
      landAt?: number;
    }
  /** Counting finished in the background (for the query in `query`). */
  | { type: "counts"; query: string; counts: Counts }
  /** null: no definitions for that word (or no definitions file). `unavailable`: they
   *  couldn't be read just now (no network); asking again later may bring them. */
  | { type: "definitions"; ask: number; definitions: Definition[] | null; unavailable?: true }
  | { type: "word"; ask: number; suggestion: Suggestion | null };

/** To the data worker (web/data-worker.ts): keep these files on the device, and let go of
 *  any others but `alsoKeep`. */
export type ToDataWorker = { type: "keep"; files: { url: string; bytes: number }[]; alsoKeep: string[] };

/** From the data worker: how far along (0 to 1), done, or not kept (and why). */
export type FromDataWorker =
  | { type: "keeping"; share: number }
  | { type: "kept" }
  | { type: "unkept"; why: "space" | "saving-data" | "error" };
