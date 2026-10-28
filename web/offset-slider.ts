/**
 * The position slider: hold a blank spot in the results (scroller-gestures.ts
 * decides what counts as a hold), feel a pulse, then slide sideways to choose
 * how many letters come before the match. A histogram sits centred across the
 * middle 80% of the screen (the active range): one bar per position, left to
 * right, as tall as the words found there, and as wide as position-scale.ts
 * gives it: 4-6 letters wide, 6 at about 75%, the rare far end squeezed. A
 * cursor marks the chosen bar; the margins either side count as the first and
 * last position, so the ends are easy to reach. Each step ticks; the list
 * scrolls to the words at that position as you go, and stays whole: scroll up
 * or down from there.
 *
 * Which side the hold starts on says which hand is holding the phone. Held
 * from the right half, the thumb's direction flips: 0 letters at the right
 * edge, more letters as it sweeps left. The histogram still reads left to
 * right, like the words; the cursor moves across it the opposite way to the
 * thumb.
 */
import { pulse, tick } from "./haptics";
import { positionDots, positionScale, type PositionScale } from "./position-scale";

const TRACK_SHARE = 0.8; // the active range, of the width; the margins either side reach the ends

export interface SliderState {
  /** the normalized query */
  query: string;
  /** words per position, as far as counted */
  byOffset: readonly number[];
  /** every position has been counted */
  complete: boolean;
}

export interface SliderEvents {
  /** What to slide over, or null when there is nothing to slide (no results). */
  state(): SliderState | null;
  /** The position changed while sliding. */
  change(value: number): void;
  /** The slider was used (to retire the hint). */
  used(): void;
}

export class OffsetSlider {
  private readonly el: HTMLElement;
  private readonly dots: HTMLElement;
  private readonly more: HTMLElement;
  private readonly frag: HTMLElement;
  private readonly note: HTMLElement;
  private readonly window: HTMLElement;
  private readonly track: HTMLElement;
  private readonly thumb: HTMLElement;
  private value = 0;
  private max = 0;
  private scale: PositionScale = positionScale(1);
  private rangeX = 0; // where the active range starts inside the window
  private range = 1; // its width in pixels
  private mirrored = false; // held from the right: the thumb's direction flips

  constructor(
    frame: HTMLElement,
    private readonly events: SliderEvents,
  ) {
    this.el = div("slider");
    this.el.setAttribute("aria-hidden", "true"); // pointer-only; Alt+←/→ does the same from the keyboard
    const label = el("p", "slider-label");
    this.dots = el("span", "slider-dots");
    this.more = el("span", "slider-more");
    this.frag = el("span", "slider-frag");
    label.append(this.dots, this.more, this.frag);
    this.note = el("p", "slider-note");
    this.window = div("slider-window");
    this.track = div("slider-track");
    this.thumb = div("slider-thumb");
    this.window.append(this.track, this.thumb);
    this.el.append(label, this.note, this.window);
    frame.append(this.el);
  }

  /** Open under a finger at screen x. False when there's nothing to slide. */
  open(x: number): boolean {
    const state = this.events.state();
    if (!state) return false;
    const box = this.window.getBoundingClientRect();
    this.mirrored = x > box.left + box.width / 2;
    pulse();
    this.events.used();
    this.el.classList.add("on");
    this.value = -1; // so the position under the finger is applied now
    this.layout(state);
    this.slideTo(x);
    return true;
  }

  close() {
    this.el.classList.remove("on");
  }

  /** The finger is at screen x: pick the position there and move the cursor
   *  to it. Left of the bars is the first position, right of them the last;
   *  held from the right, the other way round. */
  slideTo(x: number) {
    const box = this.window.getBoundingClientRect();
    const finger = Math.min(box.width, Math.max(0, x - box.left));
    // Where that is on the histogram: the same spot, or its mirror image for a
    // right thumb. The active range is centred, so mirroring is width - x.
    const inside = this.mirrored ? box.width - finger : finger;
    this.thumb.style.transform = `translateX(${inside}px)`;
    const value = Math.min(this.max, this.scale.at((inside - this.rangeX) / this.range));
    if (value === this.value) return;
    const first = this.value < 0;
    this.value = value;
    if (!first) tick();
    this.events.change(value);
    const state = this.events.state();
    if (state) this.layout(state);
  }

  /** Draw the bars, centred and fitted to the screen, and the label. */
  private layout(state: SliderState) {
    const { byOffset, complete, query } = state;
    const value = Math.max(0, this.value);
    // One position past what's counted, so you can keep going until it is.
    this.max = Math.max(0, complete ? byOffset.length - 1 : byOffset.length);
    const width = this.window.clientWidth || 300;
    this.range = width * TRACK_SHARE;
    this.rangeX = (width - this.range) / 2;
    this.scale = positionScale(this.max + 1);
    const { edges } = this.scale;
    const most = Math.max(1, ...byOffset);
    const bars: HTMLElement[] = [];
    for (let i = 0; i <= this.max; i++) {
      const bar = document.createElement("i");
      const count = byOffset[i];
      const height = count === undefined ? 3 : count === 0 ? 2 : 4 + 36 * Math.sqrt(count / most);
      const step = (edges[i + 1] - edges[i]) * this.range;
      const gap = step > 8 ? 3 : step > 4 ? 1.5 : 0.5;
      bar.style.left = `${this.rangeX + edges[i] * this.range}px`;
      bar.style.width = `${Math.max(1, step - gap)}px`;
      bar.style.height = `${height}px`;
      if (count === undefined) bar.className = "unknown";
      if (i === value) bar.className = "on";
      bars.push(bar);
    }
    this.track.replaceChildren(...bars);

    const { dots, more } = positionDots(value);
    this.dots.textContent = dots;
    this.more.textContent = more;
    this.frag.textContent = query;
    const count = byOffset[value];
    const letters = `${value} ${value === 1 ? "letter" : "letters"} before`;
    this.note.textContent =
      count === undefined ? `${letters} · counting…` : `${letters} · ${count.toLocaleString()} ${count === 1 ? "word" : "words"}`;
  }
}

function div(className: string): HTMLDivElement {
  return el("div", className);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
