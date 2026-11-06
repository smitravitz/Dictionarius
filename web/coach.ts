// The first-run tour, drawn: a margin note at the foot of the screen saying what to do
// ("2 of 3"), and a ghost finger acting it out on the real list. The note and the finger
// never take a touch (only Skip does), so the person does each thing where it really is.
// What to ask for, and in which words, is web/guide.ts's.
import { TOUR, Tour, control, type TourEvent } from "./guide";

export type Screen = "start" | "results" | "elsewhere";

export interface CoachParts {
  card: HTMLElement;
  count: HTMLElement;
  text: HTMLElement;
  skip: HTMLButtonElement;
  finger: HTMLElement;
}

/** Where the finger acts a step out, on the screen as it is now, and the area the step is
 *  about (the note stays clear of it: top and bottom, in px); null: nowhere to point. */
export type Target = (event: TourEvent) => { x: number; y: number; top: number; bottom: number } | null;

const FINISHED_MS = 4000; // how long "That's all three" stays

export class Coach {
  private screen: Screen = "elsewhere";
  private finishing: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly tour: Tour,
    private readonly parts: CoachParts,
    private readonly target: Target,
    private readonly store: (value: string | null) => void,
  ) {
    parts.skip.addEventListener("click", () => {
      tour.skip();
      store(tour.stored());
      this.draw();
    });
  }

  /** The screen changed (or moved): show the step that can be done here, if any. */
  on(screen: Screen) {
    this.screen = screen;
    this.draw();
  }

  /** The person did something: the tour moves on if it was a step. */
  did(event: TourEvent) {
    if (!this.tour.done(event)) return;
    this.store(this.tour.stored());
    if (this.tour.finished) this.finish();
    else this.draw();
  }

  /** Start the tour again (from the help sheet). */
  restart() {
    clearTimeout(this.finishing);
    this.tour.restart();
    this.store(this.tour.stored());
    this.draw();
  }

  /** Put the finger back on its target (the list scrolled, the window changed size). */
  follow() {
    if (!this.parts.finger.hidden) this.point();
  }

  private finish() {
    const { card, count, text, skip, finger } = this.parts;
    finger.hidden = true;
    count.textContent = "Done";
    text.textContent = "That's all three. Tap ? any time to see how everything works.";
    skip.hidden = true;
    card.hidden = false;
    this.finishing = setTimeout(() => (card.hidden = true), FINISHED_MS);
  }

  private draw() {
    const { card, count, text, skip, finger } = this.parts;
    if (this.finishing && this.tour.finished && !this.tour.active) return; // "That's all three" is showing
    const step = this.tour.current;
    if (!step || step.screen !== this.screen) {
      card.hidden = true;
      finger.hidden = true;
      return;
    }
    const { how, does } = control(step.control);
    count.textContent = `${this.tour.number} of ${TOUR.length}`;
    const strong = document.createElement("strong");
    strong.textContent = how;
    text.replaceChildren(strong, ` ${does}`);
    skip.hidden = false;
    card.hidden = false;
    finger.dataset.gesture = step.event;
    this.point();
  }

  private point() {
    const step = this.tour.current;
    const at = step ? this.target(step.event) : null;
    const { finger, card } = this.parts;
    finger.hidden = !at;
    card.style.bottom = ""; // its place at the foot of the screen, unless that covers the target
    if (!at) return;
    finger.style.translate = `${Math.round(at.x)}px ${Math.round(at.y)}px`;
    const GAP = 12;
    const box = card.getBoundingClientRect();
    if (box.top < at.bottom + GAP && box.bottom > at.top - GAP) {
      card.style.bottom = `${Math.round(window.innerHeight - (at.top - GAP))}px`; // just above it
    }
  }
}
