// The first-run tour, drawn: a margin note at the foot of the screen saying what to do
// ("2 of 5"), while the step's show acts it out on the real screen (web/tour-shows.ts),
// then asks for it. The note takes no touch but Skip's, so the person does each thing
// where it really is. A step done is ticked ("2 of 5 ✓"), and the next waits until the
// person has let go and been still a moment (web/hands.ts): nothing new shows while they're
// still touching. What to ask for, in which words and order, is web/guide.ts's.
import { TOUR, Tour, type TourEvent } from "./guide";
import type { Hands } from "./hands";

export type Screen = "start" | "results" | "elsewhere";

export interface CoachParts {
  card: HTMLElement;
  count: HTMLElement;
  text: HTMLElement;
  skip: HTMLButtonElement;
}

/** What a step's show is given. */
export interface Stage {
  /** Aborts when the show must stop (the step done or skipped, the screen changed);
   *  the show then puts back everything it changed, at once. */
  signal: AbortSignal;
  /** Act it out first: the first time the step comes up on this run of the tour.
   *  Otherwise straight to asking. */
  demonstrate: boolean;
  /** The top of the note: what a show lights or points at stays above it. */
  noteTop(): number;
  /** Lift the note above this area (what the step is about); null puts it back. */
  keepClear(area: { top: number; bottom: number } | null): void;
}

/** Acts a step out on the real screen, then asks for it, until stopped. */
export type Show = (stage: Stage) => void;

const FINISHED_MS = 4000; // how long "That's all five" stays
const SETTLE_MS = 600; // after a step, how long the person is still before the next one shows

export class Coach {
  private screen: Screen = "elsewhere";
  private showing: { event: TourEvent; stop: AbortController } | null = null;
  private readonly demonstrated = new Set<TourEvent>();
  private settling: AbortController | null = null; // a step just done: waiting for hands off
  private finishing: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly tour: Tour,
    private readonly parts: CoachParts,
    private readonly shows: Readonly<Record<TourEvent, Show>>,
    private readonly store: (value: string | null) => void,
    private readonly hands: Hands,
  ) {
    parts.skip.addEventListener("click", () => {
      tour.skip();
      store(tour.stored());
      this.unsettle();
      this.draw();
    });
  }

  /** The screen changed: show the step that can be done here, if any. */
  on(screen: Screen) {
    if (screen === this.screen) return; // something else changed: the show carries on
    this.screen = screen;
    this.draw();
  }

  /** The person did something: the tour moves on if it's the step asked for. */
  did(event: TourEvent) {
    const number = this.tour.number;
    if (!this.tour.done(event)) return;
    this.store(this.tour.stored());
    this.stop(); // it stops asking at once
    this.parts.count.textContent = `${number} of ${TOUR.length} ✓`;
    const settling = new AbortController();
    this.settling = settling;
    this.hands.whenStill(SETTLE_MS, settling.signal, () => {
      this.settling = null;
      if (this.tour.finished) this.finish();
      else this.draw();
    });
  }

  /** Start the tour again (from the help sheet). */
  restart() {
    clearTimeout(this.finishing);
    this.finishing = undefined;
    this.unsettle();
    this.tour.restart();
    this.demonstrated.clear();
    this.store(this.tour.stored());
    this.draw();
  }

  private finish() {
    this.stop();
    const { card, count, text, skip } = this.parts;
    count.textContent = "Done";
    text.textContent = "That's all five. Tap ? any time for How It Works.";
    skip.hidden = true;
    card.hidden = false;
    this.finishing = setTimeout(() => {
      card.hidden = true;
      this.finishing = undefined;
    }, FINISHED_MS);
  }

  /** The note for the step asked for here, and its show; nothing when there's none. */
  private draw() {
    if (this.finishing) return; // "That's all five" is showing
    const { card, count, text, skip } = this.parts;
    if (this.settling) {
      if (this.screen === "elsewhere") card.hidden = true; // the ticked step, until the next shows
      return;
    }
    const step = this.tour.current;
    if (!step || step.screen !== this.screen) {
      this.stop();
      card.hidden = true;
      return;
    }
    count.textContent = `${this.tour.number} of ${TOUR.length}`;
    const strong = document.createElement("strong");
    strong.textContent = step.how;
    text.replaceChildren(strong, ` ${step.does}`);
    skip.hidden = false;
    card.hidden = false;
    if (this.showing?.event === step.event) return; // already acting it out
    this.stop();
    const stop = new AbortController();
    this.showing = { event: step.event, stop };
    const demonstrate = !this.demonstrated.has(step.event);
    this.demonstrated.add(step.event);
    this.shows[step.event]({
      signal: stop.signal,
      demonstrate,
      noteTop: () => card.getBoundingClientRect().top,
      keepClear: (area) => this.keepClear(area),
    });
  }

  private unsettle() {
    this.settling?.abort();
    this.settling = null;
  }

  private stop() {
    this.showing?.stop.abort();
    this.showing = null;
    this.keepClear(null);
  }

  private keepClear(area: { top: number; bottom: number } | null) {
    const { card } = this.parts;
    card.style.bottom = ""; // its place at the foot of the screen, unless that covers the area
    if (!area || card.hidden) return;
    const GAP = 12;
    const box = card.getBoundingClientRect();
    if (box.top < area.bottom + GAP && box.bottom > area.top - GAP) {
      card.style.bottom = `${Math.round(window.innerHeight - (area.top - GAP))}px`; // just above it
    }
  }
}
