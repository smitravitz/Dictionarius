/**
 * The position slider. Press and hold a blank spot in the results (not a
 * word: holding a word is kept for something else), feel a pulse, then slide
 * sideways to choose how many letters come before the match. A histogram
 * sits centred across the middle 80% of the screen (the active range): one
 * bar per position, as tall as the words found there, and as wide as
 * position-scale.ts gives it: 4-6 letters wide, 6 at about 75%, the rare far
 * end squeezed. The cursor stays under the finger; the margins either side
 * count as the first and last position, so the ends are easy to reach. Each
 * step ticks; the list scrolls to the words at that position as you go, and
 * stays whole: scroll up or down from there.
 */
import { pulse, release, tick } from "./haptics";
import { positionScale, type PositionScale } from "./position-scale";

const HOLD_MS = 420; // just under Android's long-press, so ours wins
const MOVE_SLOP = 8; // moving further than this before the hold means scrolling
const MAX_DOTS = 10;
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
  /** True while the slider is open: the list's own drag-scrolling stands back. */
  active = false;

  private readonly el: HTMLElement;
  private readonly dots: HTMLElement;
  private readonly frag: HTMLElement;
  private readonly note: HTMLElement;
  private readonly window: HTMLElement;
  private readonly track: HTMLElement;
  private readonly thumb: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pointerId = -1;
  private pointerType = "";
  /** Where the press landed. Touch events keep going to it even after the
   *  list is rebuilt under the finger (which detaches it), so the listener
   *  that stops the browser from scrolling must sit on it too. */
  private touched: EventTarget | null = null;
  private readonly blockScroll = (e: Event) => {
    if (this.active) e.preventDefault();
  };
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private value = 0;
  private max = 0;
  private scale: PositionScale = positionScale(1);
  private rangeX = 0; // where the active range starts inside the window
  private range = 1; // its width in pixels
  private suppressClick = false;

  constructor(
    frame: HTMLElement,
    private readonly scroller: HTMLElement,
    private readonly events: SliderEvents,
  ) {
    this.el = div("slider");
    this.el.setAttribute("aria-hidden", "true"); // pointer-only; Alt+←/→ does the same from the keyboard
    const label = el("p", "slider-label");
    this.dots = el("span", "slider-dots");
    this.frag = el("span", "slider-frag");
    label.append(this.dots, this.frag);
    this.note = el("p", "slider-note");
    this.window = div("slider-window");
    this.track = div("slider-track");
    this.thumb = div("slider-thumb");
    this.window.append(this.track, this.thumb);
    this.el.append(label, this.note, this.window);
    frame.append(this.el);

    scroller.addEventListener("pointerdown", (e) => this.down(e));
    // The finger may leave the list while sliding: follow it anywhere.
    window.addEventListener("pointermove", (e) => this.move(e));
    window.addEventListener("pointerup", (e) => this.up(e));
    window.addEventListener("pointercancel", (e) => this.up(e));
    // Once open, a sideways slide must not scroll the list or the row.
    scroller.addEventListener("touchmove", this.blockScroll, { passive: false });
    scroller.addEventListener("contextmenu", (e) => (this.active || this.timer) && e.preventDefault());
    scroller.addEventListener(
      "click",
      (e) => {
        if (!this.suppressClick) return;
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );
  }

  private down(e: PointerEvent) {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    if ((e.target as Element).closest(".before, .frag, .after")) return; // on a word
    this.cancelHold();
    this.pointerId = e.pointerId;
    this.pointerType = e.pointerType;
    this.touched = e.target;
    this.touched?.addEventListener("touchmove", this.blockScroll, { passive: false });
    this.startX = this.lastX = e.clientX;
    this.startY = e.clientY;
    this.timer = setTimeout(() => this.open(), HOLD_MS);
  }

  private move(e: PointerEvent) {
    if (e.pointerId !== this.pointerId) return;
    this.lastX = e.clientX;
    if (!this.active) {
      if (Math.hypot(e.clientX - this.startX, e.clientY - this.startY) > MOVE_SLOP) this.cancelHold();
      return;
    }
    e.preventDefault();
    this.slideTo(e.clientX);
  }

  private up(e: PointerEvent) {
    if (e.pointerId !== this.pointerId) return;
    this.cancelHold();
    this.pointerId = -1;
    this.touched?.removeEventListener("touchmove", this.blockScroll);
    this.touched = null;
    if (!this.active) return;
    this.active = false;
    release();
    this.el.classList.remove("on");
    setTimeout(() => (this.suppressClick = false), 0);
  }

  private cancelHold() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private open() {
    this.timer = undefined;
    const state = this.events.state();
    if (!state) return;
    this.active = true;
    this.suppressClick = true;
    if (this.pointerType === "mouse") {
      try {
        this.scroller.setPointerCapture(this.pointerId);
      } catch {
        // the pointer is already gone
      }
    }
    pulse();
    this.events.used();
    this.el.classList.add("on");
    this.value = -1; // so the position under the finger is applied now
    this.layout(state);
    this.slideTo(this.lastX);
  }

  /** The finger is at screen x: put the cursor there and pick the position
   *  under it. Left of the bars is the first position, right of them the last. */
  private slideTo(x: number) {
    const box = this.window.getBoundingClientRect();
    const inside = Math.min(box.width, Math.max(0, x - box.left));
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

    this.dots.textContent = "•".repeat(Math.min(value, MAX_DOTS)) + (value > MAX_DOTS ? `+${value - MAX_DOTS}` : "");
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
