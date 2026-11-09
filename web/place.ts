// Where the person was when the app went to the background: the search, how far down its
// list, and the word open, if any. Android kills apps in the background when memory runs
// short (cheap phones do it often), and the app then starts from nothing; with this kept
// on the device, it comes back to the same place instead. Only for a while: after
// KEEP_MS a start is a fresh start. main.ts keeps and restores it (the app only: a web
// page that's reloaded starts fresh, as pages do). No DOM here.

export interface Place {
  /** When it was kept (ms since 1970). */
  at: number;
  /** The search, as typed. */
  query: string;
  /** How far down the list was scrolled (px). */
  scrollTop: number;
  /** The word whose page was open, or null on the list. */
  word: string | null;
}

/** How long a kept place lasts: coming back later starts fresh. */
export const KEEP_MS = 30 * 60_000;

const LONGEST_QUERY = 100;
const LONGEST_WORD = 200;

/** What to keep for a place (null: nothing worth keeping, as on the start screen). */
export function placeToKeep(place: Omit<Place, "at">, now: number): string | null {
  if (!place.query.trim()) return null;
  return JSON.stringify({ at: now, query: place.query, scrollTop: place.scrollTop, word: place.word });
}

/** The place kept, if it's recent and makes sense; null otherwise. */
export function placeToRestore(stored: string | null, now: number): Place | null {
  if (!stored) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { at, query, scrollTop, word } = raw as Record<string, unknown>;
  if (typeof at !== "number" || typeof query !== "string" || !query.trim()) return null;
  if (at > now || now - at > KEEP_MS) return null; // stale, or from a clock set back
  return {
    at,
    query: query.slice(0, LONGEST_QUERY),
    scrollTop: typeof scrollTop === "number" && scrollTop > 0 ? Math.round(scrollTop) : 0,
    word: typeof word === "string" && word ? word.slice(0, LONGEST_WORD) : null,
  };
}
