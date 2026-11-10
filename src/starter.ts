/**
 * The starter: what a browser needs to show the app before the word list is in. The
 * word list is tens of megabytes; the starter is a small file beside it with the
 * start screen's word count and filters, and each suggestion's list worked out ahead
 * (counted, and the rows around a few of its landing spots, src/landing.ts), so tapping
 * a suggestion opens it at once. It's built from the word list itself, by the same
 * search code (tools/web-data.ts, at build time), so its answers are the word list's
 * own; its keys hash ties it to that list. No DOM here, no I/O.
 */
import type { HeadwordIndex } from "./headword-index";
import { countsOf, type Completer, type Counts, type Suggestion } from "./complete";
import type { FilterInfo, FilterState } from "./filters";
import { filterKey } from "./filters";
import { landingRow, landingWindow } from "./landing";
import { normalize } from "./normalize";
import type { WordKeys } from "./definitions";

/** Rows per page: the search worker's page (web/protocol.ts's PAGE_SIZE). */
const PAGE = 50;

/** Landing spots kept per suggestion, so tapping it again can open somewhere new. */
export const LANDINGS = 3;

/** The starter's format; a page that reads another ignores the file. */
export const STARTER_FORMAT = 1;

/** One landing: the row it opens at, and whole pages of rows around it from `from`. */
export interface Landing {
  landAt: number;
  from: number;
  items: Suggestion[];
}

/** A file served beside the word list, by name: its SHA-256 (hex) and size in bytes. The
 *  page names it with the hash, so a new version is never mistaken for an old one. */
export interface DataFile {
  sha256: string;
  bytes: number;
}

export interface Starter {
  format: typeof STARTER_FORMAT;
  /** words in the word list */
  words: number;
  /** the word list's keys hash (hex): ties the starter to it and to its definitions */
  keysHash: string;
  /** the filters this index has the data for */
  available: FilterInfo[];
  /** filterKey() of the filters the lists were worked out with (the defaults) */
  filters: string;
  /** each suggestion's counts (complete) and landing spots, by its normalized piece */
  pieces: Record<string, { counts: Counts; landings: Landing[] }>;
  /** the data files served with it (set by the build): the word list, gzipped or not,
   *  and its definitions, so the page can keep them on the device by version */
  files: Record<string, DataFile>;
}

/** The starter for an index: each piece in `pieces` searched with `filters`, counted to
 *  the end, and its rows kept around LANDINGS spots picked as a landing picks them. */
export function buildStarter(
  index: HeadwordIndex,
  completer: Completer,
  pieces: readonly string[],
  filters: FilterState,
  files: Record<string, DataFile> = {},
  random: () => number = Math.random,
): Starter {
  const key = filterKey(filters);
  const out: Starter["pieces"] = {};
  for (const piece of pieces) {
    const query = normalize(piece);
    const m = completer.search(query, { filters });
    while (!m.complete) m.count(1_000_000);
    const total = m.total!;
    const landings: Landing[] = [];
    for (let n = 0; n < LANDINGS; n++) {
      const landAt = landingRow(total, random) ?? 0;
      if (landings.some((l) => l.landAt === landAt)) continue; // a short list has few spots
      const { from, to } = landingWindow(landAt, PAGE);
      landings.push({ landAt, from, items: m.rows(from, to) });
    }
    out[query] = { counts: countsOf(m, key), landings };
  }
  const hash = index.keysHash();
  return {
    format: STARTER_FORMAT,
    words: index.size,
    keysHash: hash ? hex(hash) : "",
    available: completer.availableFilters(),
    filters: key,
    pieces: out,
    files,
  };
}

/** A suggestion's list, landed, from the starter: null when it hasn't that piece, or was
 *  worked out with other filters than `filters` (a filterKey()). */
export function landingFrom(
  starter: Starter,
  query: string,
  filters: string,
  random: () => number = Math.random,
): (Landing & { counts: Counts }) | null {
  const piece = filters === starter.filters ? starter.pieces[query] : undefined;
  if (!piece || piece.landings.length === 0) return null;
  const landing = piece.landings[Math.min(piece.landings.length - 1, Math.floor(random() * piece.landings.length))];
  return { ...landing, counts: piece.counts };
}

/** Rows [from, to) of a suggestion's list, if one of its landings holds them all; null otherwise. */
export function rowsFrom(starter: Starter, query: string, filters: string, from: number, to: number): Suggestion[] | null {
  const piece = filters === starter.filters ? starter.pieces[query] : undefined;
  if (!piece) return null;
  const total = piece.counts.total ?? 0;
  const end = Math.min(to, total);
  for (const l of piece.landings) {
    if (from >= l.from && end <= l.from + l.items.length) return l.items.slice(from - l.from, end - l.from);
  }
  return null;
}

/** What the definitions need of the word list, from the starter: the list's size and
 *  keys hash, and the keys of the starter's own words (the only words on screen until
 *  the list is in). Another word's key throws. */
export function starterKeys(starter: Starter): WordKeys {
  const keys = new Map<number, string>();
  for (const piece of Object.values(starter.pieces)) {
    for (const l of piece.landings) for (const s of l.items) keys.set(s.id, s.key);
  }
  const hash = unhex(starter.keysHash);
  return {
    size: starter.words,
    keysHash: () => hash,
    key(id) {
      const key = keys.get(id);
      if (key === undefined) throw new Error(`word ${id} isn't in the starter`);
      return key;
    },
  };
}

/** The starter's file beside a word list: headwords.bin -> headwords.starter.json. */
export function starterUrl(indexUrl: string): string {
  return indexUrl.replace(/\.bin(?=$|[?#])/, ".starter.json");
}

/** The starter read from JSON, or null if it isn't one this page can use. */
export function readStarter(json: unknown): Starter | null {
  if (typeof json !== "object" || json === null) return null;
  const s = json as Partial<Starter>;
  const ok =
    s.format === STARTER_FORMAT &&
    typeof s.words === "number" &&
    typeof s.keysHash === "string" &&
    typeof s.filters === "string" &&
    Array.isArray(s.available) &&
    typeof s.pieces === "object" &&
    s.pieces !== null &&
    typeof s.files === "object" &&
    s.files !== null;
  return ok ? (s as Starter) : null;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function unhex(text: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/.test(text)) return null;
  return Uint8Array.from(text.match(/../g)!, (pair) => parseInt(pair, 16));
}
