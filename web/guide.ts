// How Dictionarius is used, said once: the help sheet (the "?" by the cog) lists every
// control, and the first-run tour asks for three of them, in the same words. No DOM here:
// web/coach.ts draws the tour; main.ts tells it what the person did.

/** A control: what to do (`how`), and what it does. */
export interface Control {
  key: string;
  how: string;
  does: string;
}

export const CONTROLS: readonly Control[] = [
  { key: "search", how: "Type any piece of a word", does: "to find every word that has it, wherever it sits: first the words that start with it." },
  { key: "suggestion", how: "Tap a piece on the start screen", does: "to search for it and open its words around the middle." },
  { key: "open", how: "Tap a word", does: "for its page: meanings, examples, pronunciation and origin." },
  { key: "peek", how: "Hold a word", does: "to peek at what it means. Let go to close it." },
  { key: "scrub", how: "Hold the space beside the words, then slide sideways", does: "to choose how many letters come before the piece. Up or down scrolls instead." },
  { key: "swipe", how: "On a word's page, swipe left or right", does: "for the next or the previous word in the list." },
  { key: "back", how: "Back", does: "returns to the list, where you left it." },
  { key: "filters", how: "The funnel", does: "sets how long the words are." },
  { key: "settings", how: "The cog", does: "chooses what the list shows, such as safe search." },
];

/** What the person did that a step asks for (main.ts reports these). */
export type TourEvent = "searched" | "peeked" | "scrubbed";

export interface TourStep {
  event: TourEvent;
  /** The control it teaches (its words come from CONTROLS). */
  control: string;
  /** Where it can be done: the start screen or the results. */
  screen: "start" | "results";
}

/** The first-run tour: three things to do, the essentials, done in any order. */
export const TOUR: readonly TourStep[] = [
  { event: "searched", control: "suggestion", screen: "start" },
  { event: "peeked", control: "peek", screen: "results" },
  { event: "scrubbed", control: "scrub", screen: "results" },
];

export function control(key: string): Control {
  const found = CONTROLS.find((c) => c.key === key);
  if (!found) throw new Error(`no control ${key}`);
  return found;
}

/** Where the tour is: what's been done, and what to ask for next. Remembered on the
 *  device as `stored()` (read back with the constructor); "done" once finished or skipped. */
export class Tour {
  private readonly did = new Set<TourEvent>();
  private over: boolean;

  constructor(stored: string | null) {
    this.over = stored === "done";
  }

  /** Whether it's still asking for something. */
  get active(): boolean {
    return !this.over;
  }

  /** The first step not yet done; null when there's none. */
  get current(): TourStep | null {
    if (this.over) return null;
    return TOUR.find((step) => !this.did.has(step.event)) ?? null;
  }

  /** Which step this is, counting the ones done: "2 of 3". */
  get number(): number {
    return this.did.size + 1;
  }

  /** Every step done (not skipped). */
  get finished(): boolean {
    return this.did.size === TOUR.length;
  }

  /** The person did `event`: true when that completes a step not done before. */
  done(event: TourEvent): boolean {
    if (this.over || this.did.has(event) || !TOUR.some((step) => step.event === event)) return false;
    this.did.add(event);
    if (this.finished) this.over = true;
    return true;
  }

  skip() {
    this.over = true;
  }

  restart() {
    this.did.clear();
    this.over = false;
  }

  /** What to remember on the device. */
  stored(): string | null {
    return this.over ? "done" : null;
  }
}
