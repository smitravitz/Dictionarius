/**
 * The position slider. Press and hold a blank spot in the results (not a
 * word: holding a word is kept for something else), feel a pulse, then slide
 * sideways to choose how many letters come before the match. Under the finger
 * runs a histogram: one bar per position, as tall as the words found there.
 * Each step ticks; the list jumps to the words at that position as you go.
 */
import { pulse, release, tick } from "./haptics";

const HOLD_MS = 420; // just under Android's long-press, so ours wins
const MOVE_SLOP = 8; // moving further than this before the hold means scrolling
const MAX_DOTS = 10;

export interface SliderState {
  /** the normalized query */
  query: string;
  /** current position: letters before the match */
  value: number;
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
  private step = 20;
  private trackX = 0;
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
    this.value = state.value;
    this.layout(state);
    // Put the current position's bar right under the finger.
    const left = this.window.getBoundingClientRect().left;
    this.trackX = this.lastX - left - (this.value + 0.5) * this.step;
    this.track.style.transform = `translateX(${this.trackX}px)`;
    this.thumb.style.transform = `translateX(${this.lastX - left}px)`;
    this.el.classList.add("on");
  }

  private slideTo(x: number) {
    const left = this.window.getBoundingClientRect().left;
    this.thumb.style.transform = `translateX(${x - left}px)`;
    const value = Math.min(this.max, Math.max(0, Math.floor((x - left - this.trackX) / this.step)));
    if (value === this.value) return;
    this.value = value;
    tick();
    this.events.change(value);
    const state = this.events.state();
    if (state) this.layout({ ...state, value });
  }

  /** Draw the bars and the label for `state`. */
  private layout(state: SliderState) {
    const { byOffset, complete, value, query } = state;
    // One position past what's counted, so you can keep going until it is.
    this.max = Math.max(value, complete ? byOffset.length - 1 : byOffset.length);
    const width = this.window.clientWidth || 300;
    this.step = Math.min(28, Math.max(14, (width * 0.92) / (this.max + 1)));
    const most = Math.max(1, ...byOffset);
    const bars: HTMLElement[] = [];
    for (let i = 0; i <= this.max; i++) {
      const bar = document.createElement("i");
      const count = byOffset[i];
      const height = count === undefined ? 3 : count === 0 ? 2 : 4 + 36 * Math.sqrt(count / most);
      bar.style.left = `${i * this.step}px`;
      bar.style.width = `${this.step - 3}px`;
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
