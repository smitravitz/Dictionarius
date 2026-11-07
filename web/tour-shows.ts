/**
 * The first-run tour's shows (web/coach.ts runs one per step): each step acted out on the
 * real screen, quickly, then asked for until the coach stops it.
 *
 * - searched: the ring taps a piece, twice, then rests on it.
 * - scrubbed: the space beside a word is held and dragged, by itself: the real slider opens
 *   and moves the piece, the list following, then lets go, and the list is put back where it
 *   was. Then the ring holds and slides there, over and over, until the person does it.
 * - peeked: a see-through highlight over a whole word, pulsing, word after word on screen in
 *   no particular order, each once before any again (ShuffleBag), until the person holds one.
 * - filtered: the ring taps the funnel, twice, then rests on it.
 *
 * None of it is the person's go: main.ts reports only their own actions to the coach. Nothing
 * here takes a touch (styles.css). A demonstration only starts on an idle screen: never under
 * a finger that's down, and not once the person has touched, typed or scrolled since the step
 * came up. A touch, key or wheel stops one at once, and stopping puts back everything a show
 * changed. With reduced motion nothing is acted out or pulses: the ring and the highlight
 * just stand where to do it.
 */
import type { Show, Stage } from "./coach";
import { ShuffleBag, type TourEvent } from "./guide";
import { wordLetters } from "./scroller-gestures";

export interface ShowParts {
  /** The ghost finger: a ring, acting out a gesture (its data-gesture; styles.css). */
  ring: HTMLElement;
  /** The highlight laid over a word. */
  glow: HTMLElement;
  /** The pieces on the start screen. */
  pieces: HTMLElement;
  /** The results list's scrolling box. */
  scroller: HTMLElement;
  funnel: HTMLElement;
  slider: { open(x: number, quiet: boolean): boolean; slideTo(x: number): void; close(): void };
  /** Remember where the list is; the function returned puts it back there. */
  holdPlace(): () => void;
}

const TAPS_MS = 2 * 1200; // two taps (styles.css: finger-tap)
const WAIT_MS = 800; // after the list opens, before the scrubber's show: a moment to see it
const HOP_MS = 1300; // each word's turn under the highlight
const HOP_STILL_MS = 2200; // the same, with reduced motion: no pulse, a slower hop
// The scrubber's show: press, drag out, pause, drag back, let go (ms).
const PRESS = 450;
const OUT = 1000;
const PAUSE = 350;
const BACK = 800;
const LIFT = 250;
const BESIDE = 40; // where a hold beside the words goes: this far in from the list's right edge
const ROOM = 96; // a word ending this close to the edge leaves no room beside it

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** What the person does that a demonstration gives way to (heard first, on the window). */
const HANDS_ON = ["pointerdown", "keydown", "wheel"] as const;

export function tourShows(parts: ShowParts): Record<TourEvent, Show> {
  const { ring, glow, pieces, scroller, funnel, slider } = parts;

  // Fingers (and mouse buttons) down now, anywhere: no show starts acting under one.
  const down = new Set<number>();
  window.addEventListener("pointerdown", (event) => down.add(event.pointerId), true);
  for (const type of ["pointerup", "pointercancel"] as const) {
    window.addEventListener(type, (event) => down.delete(event.pointerId), true);
  }

  /** Calls `fn` the first time the person touches, types or scrolls, until stopped or
   *  `quit()` is called. */
  function onHandsOn(signal: AbortSignal, fn: () => void) {
    const stop = new AbortController();
    const heard = () => {
      stop.abort();
      fn();
    };
    for (const type of HANDS_ON) window.addEventListener(type, heard, { capture: true, signal: stop.signal });
    signal.addEventListener("abort", () => stop.abort());
    return () => stop.abort();
  }

  /** The ring at (x, y), doing `gesture`. */
  function ringAt(x: number, y: number, gesture: string) {
    ring.dataset.gesture = gesture;
    ring.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
    ring.hidden = false;
  }

  /** The ring taps `target()` twice, then rests on it; it follows if the window changes. */
  function tapThenRest(stage: Stage, target: () => DOMRect | null) {
    let gesture = stage.demonstrate && !still() ? "tap" : "rest";
    const place = () => {
      const box = target();
      if (!box || !box.width) {
        ring.hidden = true;
        return;
      }
      ringAt(box.left + box.width / 2, box.top + box.height / 2, gesture);
    };
    place();
    const rest = setTimeout(() => {
      gesture = "rest";
      place();
    }, TAPS_MS);
    window.addEventListener("resize", place, { signal: stage.signal });
    stage.signal.addEventListener("abort", () => {
      clearTimeout(rest);
      ring.hidden = true;
    });
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

  const scrubbed: Show = (stage) => {
    const { signal } = stage;
    let acting = false; // the slider's show is on: the list moving is its doing

    /** A spot beside a short word, the one nearest the middle of the list (clear of the
     *  slider, which opens at the top): where a hold opens the slider. */
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
        return { x: view.right - BESIDE, y: box.top + box.height / 2 };
      }
      return null;
    };
    /** The ring asking: hold and slide, there. */
    const ask = () => {
      if (acting || signal.aborted) return;
      const at = spot();
      if (at) ringAt(at.x, at.y, "slide");
      else ring.hidden = true;
    };
    onMove(signal, ask);
    signal.addEventListener("abort", () => (ring.hidden = true));

    // Act it out once the rows are in and the person has had a moment to see the list,
    // unless they've put a hand on it by then: straight to asking.
    let handsOn = false;
    const quitListening = onHandsOn(signal, () => (handsOn = true));
    whenThere(signal, spot, () => {
      if (!stage.demonstrate || still()) return ask();
      const begin = setTimeout(() => {
        quitListening();
        const at = spot();
        if (handsOn || down.size > 0 || !at) return ask();
        act(at);
      }, WAIT_MS);
      signal.addEventListener("abort", () => clearTimeout(begin));
    });

    /** Hold beside the word, drag out and back, let go: the real slider, with nobody's finger on it. */
    function act(at: { x: number; y: number }) {
      acting = true;
      const putBack = parts.holdPlace();
      const reach = Math.min(200, scroller.clientWidth * 0.45);
      let opened = false;
      let frame = 0;
      // Over at once, everything as it was: on time, on a touch, or when the tour moves on.
      const end = () => {
        if (!acting) return;
        acting = false;
        cancelAnimationFrame(frame);
        quit();
        signal.removeEventListener("abort", end);
        if (opened) slider.close();
        putBack();
      };
      const over = () => {
        end();
        ask();
      };
      const quit = onHandsOn(signal, over); // heard before anything else, so the person's press finds the list as it was
      signal.addEventListener("abort", end);

      ringAt(at.x, at.y, "press");
      const start = performance.now();
      const step = (now: number) => {
        const t = now - start;
        if (t >= PRESS && !opened) {
          opened = slider.open(at.x, true);
          if (!opened) return over(); // nothing to slide over (yet): just ask
          ring.dataset.gesture = "drag";
        }
        if (t >= PRESS + OUT + PAUSE + BACK + LIFT) return over(); // done: let go, and ask
        if (opened) {
          const x = at.x - reach * dragged(t - PRESS);
          ring.style.translate = `${Math.round(x)}px ${Math.round(at.y)}px`;
          if (t < PRESS + OUT + PAUSE + BACK) slider.slideTo(x);
          else ring.dataset.gesture = "lift";
        }
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
    const { signal } = stage;
    const bag = new ShuffleBag<string>();
    let lit: string | null = null; // the row lit now (its data-row)
    let pulse: Animation | null = null;

    /** The highlight over the lit row's word, as much of it as the row shows; false
     *  when that row isn't on screen (any more). */
    const cover = (): boolean => {
      const row = lit === null ? null : scroller.querySelector<HTMLElement>(`li.word[data-row="${lit}"]:not(.pending)`);
      const word = row && rowsInView(stage).includes(row) ? wordLetters(row) : null;
      const track = row?.querySelector(".track")?.getBoundingClientRect();
      if (!word || !track) {
        glow.hidden = true;
        return false;
      }
      const left = Math.max(word.left, track.left) - 4;
      const right = Math.min(word.right, track.right) + 4;
      glow.style.translate = `${Math.round(left)}px ${Math.round(word.top - 2)}px`;
      glow.style.width = `${Math.round(right - left)}px`;
      glow.style.height = `${Math.round(word.bottom - word.top + 4)}px`;
      glow.hidden = false;
      return true;
    };
    const hop = () => {
      lit = bag.next(rowsInView(stage).filter((row) => wordLetters(row)).map((row) => row.dataset.row!));
      pulse?.cancel();
      pulse = null;
      if (cover() && !still()) {
        pulse = glow.animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.65 }, { opacity: 0 }], {
          duration: HOP_MS,
          easing: "ease-in-out",
          fill: "forwards",
        });
      }
    };
    hop();
    const hops = setInterval(hop, still() ? HOP_STILL_MS : HOP_MS);
    onMove(signal, cover); // it stays on its word as the list scrolls
    signal.addEventListener("abort", () => {
      clearInterval(hops);
      pulse?.cancel();
      glow.hidden = true;
    });
  };

  return {
    searched: (stage) => {
      tapThenRest(stage, () => pieces.querySelector(".lane")?.getBoundingClientRect() ?? null);
      const clear = () => {
        const bag = pieces.getBoundingClientRect();
        stage.keepClear({ top: bag.top, bottom: bag.bottom }); // the note goes above the pieces
      };
      clear();
      window.addEventListener("resize", clear, { signal: stage.signal });
    },
    scrubbed,
    peeked,
    filtered: (stage) => tapThenRest(stage, () => (funnel.hidden ? null : funnel.getBoundingClientRect())),
  };
}
