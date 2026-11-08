// How Dictionarius is used, in words: the help sheet (How It Works, the "?" by the cog)
// lists the controls; the first-run tour asks for five things, one at a time, in order.
// No DOM here: web/coach.ts draws the tour, web/tour-shows.ts acts each step out, and
// main.ts tells it what the person did.

/** A control: what to do (`how`), and what it does. */
export interface Control {
  how: string;
  does: string;
}

/** How It Works: the help sheet's list. */
export const CONTROLS: readonly Control[] = [
  { how: "Tap a piece", does: "See every word with it inside" },
  { how: "Tap a word", does: "Open its full entry" },
  { how: "Hold a word", does: "Peek at its meaning" },
  { how: "Hold beside a word, then slide", does: "Choose how many letters come before the piece" },
  { how: "Tap the funnel", does: "Filter words by length" },
  { how: "Tap the cog", does: "Choose what the list shows, like safe search" },
  { how: "Back", does: "Return to your list, right where you left it" },
];

/** What the person did that a step asks for (main.ts reports these). */
export type TourEvent = "searched" | "scrubbed" | "peeked" | "filtered" | "set";

export interface TourStep {
  event: TourEvent;
  /** Where it can be done: the start screen or the results. */
  screen: "start" | "results";
  /** What to do (in bold on the note), then what it does. */
  how: string;
  does: string;
}

/** The first-run tour: each step shown, then asked for; the next only once it's done. */
export const TOUR: readonly TourStep[] = [
  { event: "searched", screen: "start", how: "Tap a piece below", does: "to search for it and open every word with it inside:" },
  { event: "scrubbed", screen: "results", how: "Hold beside a word, then slide", does: "to choose how many letters come before the piece:" },
  { event: "peeked", screen: "results", how: "Press & Hold a word", does: "to peek at what it means:" },
  { event: "filtered", screen: "results", how: "Tap the funnel", does: "to filter words by length:" },
  { event: "set", screen: "results", how: "Tap the cog", does: "to choose what the list shows, like safe search:" },
];

/** Where the tour is: which step it asks for. Remembered on the device as `stored()`
 *  (read back with the constructor): "done" once finished or skipped. */
export class Tour {
  private step = 0; // TOUR's index of the step asked for
  private over: boolean;

  constructor(stored: string | null) {
    this.over = stored === "done";
  }

  /** Whether it's still asking for something. */
  get active(): boolean {
    return !this.over;
  }

  /** The step asked for now; null when there's none. */
  get current(): TourStep | null {
    return this.over ? null : (TOUR[this.step] ?? null);
  }

  /** Which step this is: "2 of 5". */
  get number(): number {
    return this.step + 1;
  }

  /** Every step done (not skipped). */
  get finished(): boolean {
    return this.step === TOUR.length;
  }

  /** The person did `event`: true when it's the step asked for, which is then done.
   *  Anything else, early or again, doesn't count. */
  done(event: TourEvent): boolean {
    if (this.current?.event !== event) return false;
    this.step++;
    if (this.finished) this.over = true;
    return true;
  }

  skip() {
    this.over = true;
  }

  restart() {
    this.step = 0;
    this.over = false;
  }

  /** What to remember on the device. */
  stored(): string | null {
    return this.over ? "done" : null;
  }
}

/** Picks from what's on offer in no particular order, each once before any comes round
 *  again, and never the same twice running (when there's another to pick). What's on
 *  offer may change between picks: the words on screen, as the list scrolls. */
export class ShuffleBag<T> {
  private readonly had = new Set<T>();
  private last: T | null = null;

  constructor(private readonly random: () => number = Math.random) {}

  next(offered: readonly T[]): T | null {
    if (offered.length === 0) return null;
    let fresh = offered.filter((item) => !this.had.has(item));
    if (fresh.length === 0) {
      this.had.clear(); // every one has had its turn: a new round
      fresh = offered.length > 1 ? offered.filter((item) => item !== this.last) : [...offered];
    }
    const pick = fresh[Math.min(fresh.length - 1, Math.floor(this.random() * fresh.length))];
    this.had.add(pick);
    this.last = pick;
    return pick;
  }
}
