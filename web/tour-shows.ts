/**
 * The first-run tour's shows (web/coach.ts runs one per step): each step acted out on the
 * real screen, quickly, then asked for until the coach stops it. What to touch is *lit*: a
 * see-through wash drawn by the thing itself (its ::before; styles.css), so it moves with it
 * in the same frame (a drifting piece, a scrolling row), and only ever fades or pulses.
 *
 * - searched: the pieces on screen lit in turn, in no particular order, as they drift.
 * - scrubbed: the space beside a word is pressed, and the real slider opens by itself and
 *   moves the piece, the list following; then it lets go, the list put back where it was.
 *   Then that space is lit until the person holds it and slides.
 * - peeked: whole words lit in turn, in no particular order, each once before any again
 *   (ShuffleBag), until the person holds one.
 * - filtered, set: the funnel (or the cog) lit; once its sheet is open, its options lit in
 *   turn, top to bottom, until it's closed.
 *
 * None of it is the person's go: main.ts reports only their own actions to the coach. A
 * highlight takes no touch. A demonstration only starts on a still screen (web/hands.ts),
 * a touch, key or wheel stops it at once, and stopping puts back everything a show changed.
 * With reduced motion nothing is acted out, nothing pulses and highlights don't fade.
 */
import type { Show, Stage } from "./coach";
import { ShuffleBag, type TourEvent } from "./guide";
import type { Hands } from "./hands";
import { wordLetters } from "./scroller-gestures";

export interface ShowParts {
  hands: Hands;
  /** The pieces on the start screen. */
  pieces: HTMLElement;
  /** The results list's scrolling box. */
  scroller: HTMLElement;
  funnel: HTMLElement;
  filters: HTMLDialogElement;
  cog: HTMLElement;
  settings: HTMLDialogElement;
  slider: { open(x: number, quiet: boolean): boolean; slideTo(x: number): void; close(): void };
  /** Remember where the list is; the function returned puts it back there. */
  holdPlace(): () => void;
}

/** A box in px, from an element's top left corner. */
interface Part {
  x: number;
  y: number;
  w: number;
  h: number;
  radius?: number;
}

const DWELL_MS = 1800; // each thing's turn under the highlight: about one breath
const DWELL_STILL_MS = 2400; // the same, with reduced motion
const IN_MS = 320; // a highlight fading in
const BREATH_MS = 900; // and breathing: out to 40% and back, twice this
const FADE_MS = 260; // and fading out
const WAIT_MS = 800; // after the list opens, before the scrubber's show: a moment to see it
// The scrubber's show: press, drag out, pause, drag back, let go (ms).
const PRESS = 450;
const OUT = 1000;
const PAUSE = 350;
const BACK = 800;
const BESIDE = 40; // where a hold beside the words goes: this far in from the list's right edge
const ROOM = 96; // a word ending this close to the edge leaves no room beside it

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** What the person does that a demonstration gives way to (heard first, on the window). */
const HANDS_ON = ["pointerdown", "keydown", "wheel"] as const;

/** Who lights each element now: a newer highlight takes it over, and an older one's late
 *  clean-up can't touch it. */
const owners = new WeakMap<HTMLElement, Light>();

/** A highlight over `el`, or over `part` of it: drawn by the element itself (styles.css), so
 *  it goes wherever the element goes. It fades in, then breathes, and fades out from wherever
 *  the breath is: opacity alone, eased, each started here, so a new one always starts at
 *  nothing and nothing ever jumps. "held" is pressed: stronger, and still. */
class Light {
  private readonly position: string | null;
  private motion: Animation[] = [];
  private over = false;

  constructor(
    readonly el: HTMLElement,
    part: Part | null,
    state: "on" | "held" = "on",
  ) {
    owners.get(el)?.gone();
    owners.set(el, this);
    // Its ::before is placed inside it: an unpositioned element gets a position for now.
    this.position = getComputedStyle(el).position === "static" ? el.style.position : null;
    if (this.position !== null) el.style.position = "relative";
    if (part) {
      el.style.setProperty("--lit-x", `${Math.round(part.x)}px`);
      el.style.setProperty("--lit-y", `${Math.round(part.y)}px`);
      el.style.setProperty("--lit-w", `${Math.round(part.w)}px`);
      el.style.setProperty("--lit-h", `${Math.round(part.h)}px`);
      if (part.radius !== undefined) el.style.setProperty("--lit-radius", `${part.radius}px`);
    }
    el.dataset.tourLit = state;
    if (still()) return;
    const on = { pseudoElement: "::before" } as const;
    this.motion.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { ...on, duration: IN_MS, easing: "ease-out" }));
    if (state === "on") {
      this.motion.push(el.animate([{ opacity: 1 }, { opacity: 0.4 }], {
        ...on, duration: BREATH_MS, delay: IN_MS, easing: "ease-in-out", iterations: Infinity, direction: "alternate",
      }));
    }
  }

  /** Fade out from wherever its breath is, then take it all away. */
  out() {
    const { el } = this;
    if (this.over || el.dataset.tourLit === "out") return;
    if (still() || !el.getClientRects().length) return this.gone(); // not on screen: nothing to fade
    const opacity = getComputedStyle(el, "::before").opacity;
    for (const animation of this.motion) animation.cancel();
    el.dataset.tourLit = "out";
    const fade = el.animate([{ opacity }, { opacity: 0 }], { duration: FADE_MS, easing: "ease-in", pseudoElement: "::before", fill: "forwards" });
    this.motion = [fade];
    fade.finished.then(() => this.gone(), () => this.gone());
  }

  /** Taken away at once, the element as it was (unless a newer highlight has it now). */
  gone() {
    if (this.over) return;
    this.over = true;
    for (const animation of this.motion) animation.cancel();
    this.motion = [];
    const { el } = this;
    if (owners.get(el) !== this) return;
    owners.delete(el);
    delete el.dataset.tourLit;
    for (const name of ["--lit-x", "--lit-y", "--lit-w", "--lit-h", "--lit-radius"]) el.style.removeProperty(name);
    if (this.position !== null) el.style.position = this.position;
  }
}

/** Calls `fn` the first time the person touches, types or scrolls, until stopped or the
 *  returned function is called. */
function onHandsOn(signal: AbortSignal, fn: () => void): () => void {
  const stop = new AbortController();
  const heard = () => {
    stop.abort();
    fn();
  };
  for (const type of HANDS_ON) window.addEventListener(type, heard, { capture: true, signal: stop.signal });
  signal.addEventListener("abort", () => stop.abort());
  return () => stop.abort();
}

export function tourShows(parts: ShowParts): Record<TourEvent, Show> {
  const { hands, pieces, scroller, slider } = parts;

  /** Lights one of what `offered()` gives at a time, each for a while: in no particular
   *  order (each once before any again), or top to bottom. Moves on early when the lit one
   *  leaves the screen. Until stopped, when the last one fades. */
  function lightInTurn(
    signal: AbortSignal,
    offered: () => HTMLElement[],
    part: (el: HTMLElement) => Part | null = () => null,
    order: "shuffled" | "in order" = "shuffled",
  ) {
    const bag = new ShuffleBag<HTMLElement>();
    let next = 0;
    let light: Light | null = null;
    const pick = (on: HTMLElement[]) => (order === "shuffled" ? bag.next(on) : on.length ? on[next++ % on.length] : null);
    const turn = () => {
      const on = offered();
      const el = pick(on);
      if (el === light?.el) return; // the only one: it stays lit
      light?.out();
      light = el ? new Light(el, part(el)) : null;
    };
    turn();
    const turns = setInterval(turn, still() ? DWELL_STILL_MS : DWELL_MS);
    // Scrolled away: on to one that's on screen.
    onMove(signal, () => {
      if (light && !offered().includes(light.el)) turn();
    });
    signal.addEventListener("abort", () => {
      clearInterval(turns);
      light?.out();
    });
  }

  /** `fn` at most once a frame while the list scrolls or the window changes, until stopped. */
  function onMove(signal: AbortSignal, fn: () => void) {
    let frame = 0;
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), fn()));
    };
    scroller.addEventListener("scroll", soon, { passive: true, signal });
    window.addEventListener("resize", soon, { signal });
    signal.addEventListener("abort", () => cancelAnimationFrame(frame));
  }

  /** Calls `fn` with what `find` finds, as soon as it finds something (it looks again
   *  every so often: the list's rows may still be on their way), unless stopped first. */
  function whenThere<T>(signal: AbortSignal, find: () => T | null, fn: (found: T) => void) {
    const look = () => {
      if (signal.aborted) return;
      const found = find();
      if (found) fn(found);
      else timer = setTimeout(look, 150);
    };
    let timer = setTimeout(look, 0);
    signal.addEventListener("abort", () => clearTimeout(timer));
  }

  /** Rows wholly in the list's view and above the note, top to bottom. */
  function rowsInView(stage: Stage): HTMLElement[] {
    const view = scroller.getBoundingClientRect();
    const floor = Math.min(view.bottom, stage.noteTop());
    return [...scroller.querySelectorAll<HTMLElement>("li.word:not(.pending)")].filter((row) => {
      const box = row.getBoundingClientRect();
      return box.top >= view.top && box.bottom <= floor;
    });
  }

  /** A word's letters, as a part of its line (a little room around them). */
  function lettersOf(line: HTMLElement): Part | null {
    const row = line.closest("li.word");
    const word = row && wordLetters(row);
    const track = row?.querySelector(".track")?.getBoundingClientRect();
    if (!word || !track) return null;
    const box = line.getBoundingClientRect();
    const left = Math.max(word.left, track.left) - 6;
    const right = Math.min(word.right, track.right) + 6;
    return { x: left - box.left, y: word.top - box.top - 3, w: right - left, h: word.bottom - word.top + 6, radius: 8 };
  }

  const searched: Show = (stage) => {
    // The pieces wholly on screen, as they drift.
    const tiles = () => {
      const view = pieces.getBoundingClientRect();
      const left = Math.max(view.left, 0) + 8;
      const right = Math.min(view.right, window.innerWidth) - 8;
      return [...pieces.querySelectorAll<HTMLElement>(".tile-face")].filter((face) => {
        const box = face.getBoundingClientRect();
        return box.width > 0 && box.left >= left && box.right <= right;
      });
    };
    lightInTurn(stage.signal, tiles);
    const clear = () => {
      const bag = pieces.getBoundingClientRect();
      stage.keepClear({ top: bag.top, bottom: bag.bottom }); // the note goes above the pieces
    };
    clear();
    window.addEventListener("resize", clear, { signal: stage.signal });
  };

  const scrubbed: Show = (stage) => {
    const { signal } = stage;
    const shown = performance.now();
    let acting = false; // the slider's show is on: the list moving is its doing
    let light: Light | null = null;

    /** A short word nearest the middle of the list (clear of the slider, which opens at
     *  the top), and the space beside it: where a hold opens the slider. */
    const spot = () => {
      const view = scroller.getBoundingClientRect();
      const middle = (view.top + Math.min(view.bottom, stage.noteTop())) / 2;
      const away = (row: HTMLElement) => {
        const box = row.getBoundingClientRect();
        return Math.abs(box.top + box.height / 2 - middle);
      };
      for (const row of rowsInView(stage).sort((a, b) => away(a) - away(b))) {
        const word = wordLetters(row);
        if (!word || word.right > view.right - ROOM) continue;
        const box = row.getBoundingClientRect();
        const from = word.right + 16 - box.left;
        const space: Part = { x: from, y: 6, w: view.right - 8 - box.left - from, h: box.height - 12, radius: 12 };
        return { row, space, x: view.right - BESIDE, y: box.top + box.height / 2 };
      }
      return null;
    };
    /** Asking: the space beside a word lit, staying on it while it's on screen. */
    const ask = () => {
      if (acting || signal.aborted) return;
      if (light && light.el.isConnected && rowsInView(stage).includes(light.el) && light.el.dataset.tourLit === "on") return;
      light?.out();
      const at = spot();
      light = at ? new Light(at.row, at.space) : null;
    };
    onMove(signal, ask);
    signal.addEventListener("abort", () => light?.out());

    // Act it out once the rows are in and the person has had a moment to see the list,
    // unless they've put a hand on it by then: straight to asking.
    whenThere(signal, spot, () => {
      if (!stage.demonstrate || still()) return ask();
      const begin = setTimeout(() => {
        const at = spot();
        if (hands.busy || hands.since(shown) || !at) return ask();
        act(at);
      }, WAIT_MS);
      signal.addEventListener("abort", () => clearTimeout(begin));
    });

    /** Press beside the word, drag out and back, let go: the real slider, with nobody's finger on it. */
    function act(at: { row: HTMLElement; space: Part; x: number; y: number }) {
      acting = true;
      const putBack = parts.holdPlace();
      const reach = Math.min(200, scroller.clientWidth * 0.45);
      const pressed = new Light(at.row, at.space, "held");
      let opened = false;
      let frame = 0;
      // Over at once, everything as it was: on time, on a touch, or when the tour moves on.
      const end = () => {
        if (!acting) return;
        acting = false;
        cancelAnimationFrame(frame);
        quit();
        signal.removeEventListener("abort", end);
        pressed.gone();
        if (opened) slider.close();
        putBack();
      };
      const over = () => {
        end();
        ask();
      };
      const quit = onHandsOn(signal, over); // heard before anything else: the person's press finds the list as it was
      signal.addEventListener("abort", end);

      const start = performance.now();
      const step = (now: number) => {
        const t = now - start;
        if (t >= PRESS && !opened) {
          opened = slider.open(at.x, true);
          if (!opened) return over(); // nothing to slide over (yet): just ask
          pressed.out(); // the list moves now: the row goes with it
        }
        if (t >= PRESS + OUT + PAUSE + BACK) return over(); // done: let go, and ask
        if (opened) slider.slideTo(at.x - reach * dragged(t - PRESS));
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }
  };

  /** How far out the scrubber's show has dragged (0 to 1), `t` ms into the drag. */
  function dragged(t: number): number {
    const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
    if (t <= 0) return 0;
    if (t < OUT) return ease(t / OUT);
    if (t < OUT + PAUSE) return 1;
    if (t < OUT + PAUSE + BACK) return 1 - ease((t - OUT - PAUSE) / BACK);
    return 0;
  }

  const peeked: Show = (stage) => {
    const lines = () => rowsInView(stage).map((row) => row.querySelector<HTMLElement>(".line")).filter((line): line is HTMLElement => !!line && !!lettersOf(line));
    lightInTurn(stage.signal, lines, lettersOf);
  };

  /** The button lit; once its sheet is open, the sheet's options lit in turn, top to bottom. */
  const sheet = (button: () => HTMLElement, dialog: () => HTMLDialogElement, options: string): Show => (stage) => {
    const { signal } = stage;
    let turn: AbortController | null = null;
    const show = () => {
      turn?.abort();
      turn = new AbortController();
      const open = dialog().open;
      const what = open ? () => [...dialog().querySelectorAll<HTMLElement>(options)] : () => (button().hidden ? [] : [button()]);
      lightInTurn(turn.signal, what, () => null, "in order");
    };
    show();
    const watch = new MutationObserver(show); // the sheet opened or closed
    watch.observe(dialog(), { attributes: true, attributeFilter: ["open"] });
    signal.addEventListener("abort", () => {
      watch.disconnect();
      turn?.abort();
    });
  };

  return {
    searched,
    scrubbed,
    peeked,
    filtered: sheet(() => parts.funnel, () => parts.filters, "#ranges .range"),
    set: sheet(() => parts.cog, () => parts.settings, "#switches .setting"),
  };
}
