/**
 * How good the connection is, judged from the dictionary's own download: bytes in, by time,
 * as the data worker reports them. Nothing is sent anywhere to measure it, and it works in
 * every browser (navigator.connection is Chromium's only).
 */

export type Quality = "fast" | "slow" | "very slow" | "none";

/** A moment of the download: when (ms), and how many bytes were in by then. */
export interface Sample {
  at: number;
  bytes: number;
}

/** Judged over the last few seconds, so it follows the connection as it changes. */
const WINDOW_MS = 5000;
/** Less than this to judge by, and it says nothing yet. */
const LEAST_MS = 1000;
/** Nothing in for this long: no connection. */
const STALL_MS = 8000;
/** At least this fast (bytes a second): the 34 MB dictionary in about half a minute. */
const FAST = 1_000_000;
/** At least this: a few minutes. Below it, very slow. */
const SLOW = 100_000;

/** The connection's quality at `now`, from `samples` (oldest first); null while it can't tell. */
export function connectionQuality(samples: readonly Sample[], now: number, online: boolean): Quality | null {
  if (!online) return "none";
  const last = samples.at(-1);
  if (!last) return null;
  if (now - last.at >= STALL_MS) return "none";
  const first = samples.find((s) => s.at >= last.at - WINDOW_MS) ?? last; // the last few seconds in
  const span = last.at - first.at;
  if (span < LEAST_MS) return null;
  const perSecond = ((last.bytes - first.bytes) * 1000) / span;
  return perSecond >= FAST ? "fast" : perSecond >= SLOW ? "slow" : "very slow";
}
