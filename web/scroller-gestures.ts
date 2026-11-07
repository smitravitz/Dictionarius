/**
 * Everything a press on the results list can mean, decided in one place.
 *
 * - A tap opens the word under it. On a touch screen while typing, it only
 *   puts the keyboard away: the keyboard closing moves the list under the
 *   finger, so the tap would land on a word nobody aimed at.
 * - A hold on a word peeks at its definition until the finger lifts. "On a
 *   word" is anywhere up or down its row across the word's width, so a hold
 *   between two rows peeks the nearer word (the rows meet halfway).
 * - A hold on a blank spot (beside the words, not between them) shows the
 *   position slider, a little later than a peek. The finger's first clear
 *   move then decides: sideways scrubs (the slider follows the finger until
 *   it lifts); up or down lets the slider go and scrolls the list.
 * - A finger that moves is scrolling, which the browser does itself.
 * - The mouse drags the list up and down (with momentum on release) and a
 *   row sideways, as a finger would.
 *
 * PressClassifier makes those calls from plain numbers, so tests drive it
 * directly; ScrollerGestures connects it to the page's pointer events and
 * carries out the scrolling.
 */

export const HOLD_MS = 300; // a hold on a word: well under Android's long-press (400 ms), so ours comes first
export const ARM_MS = 380; // a hold on a blank spot: a beat longer, so a resting finger doesn't open the slider (still under 400)
const SLOP = 8; // moving further than this means scrolling or dragging, not a tap or hold
export const DECIDE = 16; // after a hold, moving this far says which way: sideways scrubs, up or down scrolls
/** How far either side of a word's letters a press still counts as on it (a fingertip's width, about). */
export const WORD_REACH = 16;

/** Whether screen x falls on the word of the row holding `target`: across its letters
 *  (give or take WORD_REACH), anywhere up or down the row. */
export function onWordAt(target: Element, x: number): boolean {
  const row = target.closest("li.word:not(.pending)");
  const word = row ? wordLetters(row) : null;
  return !!word && x >= word.left - WORD_REACH && x <= word.right + WORD_REACH;
}

/** Where a row's word is on screen: all of its letters, before the fragment, the
 *  fragment and after it (some may be scrolled out of the row's view). */
export function wordLetters(row: Element): { left: number; right: number; top: number; bottom: number } | null {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const part of row.querySelectorAll(".before, .frag, .after")) {
    const box = part.getBoundingClientRect();
    if (box.width === 0) continue; // nothing before the fragment, say
    left = Math.min(left, box.left);
    right = Math.max(right, box.right);
    top = Math.min(top, box.top);
    bottom = Math.max(bottom, box.bottom);
  }
  return left < right ? { left, right, top, bottom } : null;
}

export interface PressStart {
  pointerId: number;
  pointerType: string; // "mouse", "touch" or "pen"
  primary: boolean;
  button: number;
  x: number;
  y: number;
  /** on a word's letters (not the blank space around them) */
  onWord: boolean;
  /** on a row, which can scroll sideways */
  onRow: boolean;
  /** the search box has focus: on a touch screen, its keyboard is up */
  typing: boolean;
}

export type GestureAction =
  | { type: "cancel-hold" } // moved before the hold: no slider
  | { type: "arm"; x: number } // held a blank spot: show the slider (held at x), nothing chosen yet
  | { type: "hold-word" } // held a word: peek at it
  | { type: "release-word" } // let go of it: close the peek
  | { type: "slide"; x: number } // the slider follows the finger
  | { type: "unhold"; dx: number; dy: number } // held, then up or down: close the slider, scroll the list
  | { type: "release" } // close the slider
  | { type: "drag"; axis: "list" | "row"; dx: number; dy: number } // mouse drag, from where it started
  | { type: "drop"; axis: "list" | "row" };

/** What the click that follows a press should do. */
export type ClickVerdict = "open" | "suppress" | "dismiss-keyboard";

type State = "idle" | "pending" | "armed" | "holding" | "holding-word" | "dragging" | "scrolling";

export class PressClassifier {
  private state: State = "idle";
  private press: PressStart | null = null;
  private lastX = 0;
  private lastY = 0;
  private axis: "list" | "row" = "list";
  private verdict: ClickVerdict | null = null;

  /** The pointer of the press being followed, or -1. */
  get pointerId(): number {
    return this.press?.pointerId ?? -1;
  }

  /** A hold timer should be running for the current press. */
  get holdDue(): boolean {
    return this.state === "pending";
  }

  /** The current press is still undecided or holding (the browser's own long-press menu must wait). */
  get pressing(): boolean {
    return this.state === "pending" || this.state === "armed" || this.state === "holding" || this.state === "holding-word";
  }

  down(p: PressStart): void {
    if (!p.primary || (p.pointerType === "mouse" && p.button !== 0)) return;
    this.press = p;
    this.state = "pending";
    this.lastX = p.x;
    this.lastY = p.y;
    this.verdict = null;
  }

  move(pointerId: number, x: number, y: number): GestureAction | null {
    const p = this.press;
    if (!p || pointerId !== p.pointerId) return null;
    const dx = x - p.x;
    const dy = y - p.y;
    switch (this.state) {
      case "armed": {
        // Measured from where the hold landed, so a finger that crept a little
        // while holding still has its whole move to say which way.
        const hx = x - this.lastX;
        const hy = y - this.lastY;
        if (Math.hypot(hx, hy) < DECIDE) return null;
        if (Math.abs(hx) >= Math.abs(hy)) {
          this.state = "holding"; // a diagonal counts as sideways: scrubbing is what the hold was for
          return { type: "slide", x };
        }
        this.state = "dragging";
        this.axis = "list";
        return { type: "unhold", dx, dy };
      }
      case "holding":
        return { type: "slide", x };
      case "dragging":
        return { type: "drag", axis: this.axis, dx, dy };
      case "pending":
        this.lastX = x;
        this.lastY = y;
        if (Math.hypot(dx, dy) <= SLOP) return null;
        if (p.pointerType === "mouse") {
          this.state = "dragging";
          this.axis = Math.abs(dx) > Math.abs(dy) && p.onRow ? "row" : "list";
          return { type: "drag", axis: this.axis, dx, dy };
        }
        this.state = "scrolling";
        return { type: "cancel-hold" };
      default:
        return null;
    }
  }

  /** The hold timer fired. */
  hold(): GestureAction | null {
    if (this.state !== "pending" || !this.press) return null;
    if (this.press.onWord) {
      this.state = "holding-word";
      return { type: "hold-word" };
    }
    this.state = "armed";
    return { type: "arm", x: this.lastX };
  }

  up(pointerId: number): GestureAction | null {
    const p = this.press;
    if (!p || pointerId !== p.pointerId) return null;
    const state = this.state;
    this.verdict = state !== "pending" ? "suppress" : p.typing && p.pointerType !== "mouse" ? "dismiss-keyboard" : "open";
    return this.finish(state);
  }

  /** The browser took the press away (or the slider had nothing to show). */
  cancel(pointerId: number): GestureAction | null {
    const p = this.press;
    if (!p || pointerId !== p.pointerId) return null;
    const state = this.state;
    this.verdict = "suppress";
    return this.finish(state);
  }

  /** The click after a press: what it should do. Once per press; a click no
   *  press led to (a keyboard, a screen reader) opens. */
  click(): ClickVerdict {
    const verdict = this.verdict ?? "open";
    this.verdict = null;
    return verdict;
  }

  private finish(state: State): GestureAction | null {
    this.press = null;
    this.state = "idle";
    if (state === "armed" || state === "holding") return { type: "release" };
    if (state === "holding-word") return { type: "release-word" };
    if (state === "dragging") return { type: "drop", axis: this.axis };
    return null;
  }
}

export interface ScrollerGestureEvents {
  /** The search box has focus (on a touch screen, its keyboard is up). */
  typing(): boolean;
  dismissKeyboard(): void;
  /** Show the position slider, held at screen x (nothing chosen yet); false when there's nothing to slide. */
  holdStart(x: number): boolean;
  holdMove(x: number): void;
  holdEnd(): void;
  /** A word is held: peek at it (`target` is what the finger is on). */
  peek(target: Element): void;
  /** It was let go. */
  unpeek(): void;
}

/** Connects a PressClassifier to the results list's scroller. */
export class ScrollerGestures {
  private readonly classifier = new PressClassifier();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pointerId = -1;
  private pointerType = "";
  /** Where the press landed. Touch events keep going to it even after the
   *  list is rebuilt under the finger (which detaches it), so the listener
   *  that stops the browser from scrolling must sit on it too. */
  private touched: EventTarget | null = null;
  private holding = false;
  private row: HTMLElement | null = null; // the row a mouse drag scrolls sideways
  private startTop = 0;
  private startLeft = 0;
  private samples: { t: number; y: number }[] = [];
  private glide = 0;
  private readonly blockScroll = (e: Event) => {
    if (this.holding) e.preventDefault();
  };

  constructor(
    private readonly scroller: HTMLElement,
    private readonly events: ScrollerGestureEvents,
  ) {
    scroller.addEventListener("pointerdown", (e) => this.down(e));
    // The finger may leave the list while sliding: follow it anywhere.
    window.addEventListener("pointermove", (e) => this.move(e));
    window.addEventListener("pointerup", (e) => this.end(e, this.classifier.up(e.pointerId)));
    window.addEventListener("pointercancel", (e) => this.end(e, this.classifier.cancel(e.pointerId)));
    // While the slider is open, a sideways slide mustn't scroll the list or a row.
    scroller.addEventListener("touchmove", this.blockScroll, { passive: false });
    scroller.addEventListener("contextmenu", (e) => this.classifier.pressing && e.preventDefault());
    scroller.addEventListener(
      "click",
      (e) => {
        const verdict = this.classifier.click();
        if (verdict === "open") return;
        e.preventDefault();
        e.stopPropagation();
        if (verdict === "dismiss-keyboard") this.events.dismissKeyboard();
      },
      true,
    );
  }

  private down(e: PointerEvent) {
    const target = e.target as Element;
    const onWord = onWordAt(target, e.clientX);
    this.classifier.down({
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      primary: e.isPrimary,
      button: e.button,
      x: e.clientX,
      y: e.clientY,
      onWord,
      onRow: !!target.closest(".track"),
      typing: this.events.typing(),
    });
    if (this.classifier.pointerId !== e.pointerId) return; // not a press to follow
    cancelAnimationFrame(this.glide);
    clearTimeout(this.timer);
    this.pointerId = e.pointerId;
    this.pointerType = e.pointerType;
    this.touched = e.target;
    this.touched?.addEventListener("touchmove", this.blockScroll, { passive: false });
    this.row = target.closest<HTMLElement>(".track");
    this.startTop = this.scroller.scrollTop;
    this.startLeft = this.row?.scrollLeft ?? 0;
    this.samples = [{ t: e.timeStamp, y: e.clientY }];
    this.timer = setTimeout(() => this.hold(), onWord ? HOLD_MS : ARM_MS);
  }

  private hold() {
    const action = this.classifier.hold();
    if (action?.type === "hold-word") {
      this.holding = true; // the list stays put under the peek
      this.events.peek(this.touched as Element);
      return;
    }
    if (action?.type !== "arm") return;
    if (!this.events.holdStart(action.x)) {
      this.classifier.cancel(this.pointerId);
      return;
    }
    this.holding = true;
    if (this.pointerType === "mouse") this.capture();
  }

  private move(e: PointerEvent) {
    const action = this.classifier.move(e.pointerId, e.clientX, e.clientY);
    if (!this.classifier.holdDue) clearTimeout(this.timer);
    if (!action) return;
    if (action.type === "slide") {
      e.preventDefault();
      this.events.holdMove(action.x);
    } else if (action.type === "unhold") {
      // Up or down after a hold: the slider goes, and the list follows the
      // finger from here (the browser's own scrolling was stopped by the hold).
      e.preventDefault();
      this.events.holdEnd();
      this.samples = [{ t: e.timeStamp, y: e.clientY }]; // the flick's speed counts from here, not the hold
      this.drag(e, "list", action.dy);
    } else if (action.type === "drag") {
      if (this.holding) e.preventDefault(); // a finger's scroll after a hold: ours, not the browser's
      this.drag(e, action.axis, action.dy, action.dx);
    }
  }

  /** Move the list (or a row) with the pointer, from where the press began. */
  private drag(e: PointerEvent, axis: "list" | "row", dy: number, dx = 0) {
    if (!this.scroller.classList.contains("dragging")) {
      this.capture();
      this.scroller.classList.add("dragging");
    }
    if (axis === "row") this.row!.scrollLeft = this.startLeft - dx;
    else {
      this.scroller.scrollTop = this.startTop - dy;
      this.samples.push({ t: e.timeStamp, y: e.clientY });
      if (this.samples.length > 6) this.samples.shift();
    }
  }

  private end(e: PointerEvent, action: GestureAction | null) {
    if (e.pointerId !== this.pointerId) return;
    clearTimeout(this.timer);
    this.pointerId = -1;
    this.touched?.removeEventListener("touchmove", this.blockScroll);
    this.touched = null;
    this.holding = false;
    if (action?.type === "release") this.events.holdEnd();
    if (action?.type === "release-word") this.events.unpeek();
    if (action?.type === "drop") {
      this.scroller.classList.remove("dragging");
      if (action.axis === "list") this.coast(e.timeStamp);
    }
  }

  private capture() {
    try {
      this.scroller.setPointerCapture(this.pointerId);
    } catch {
      // the pointer is already gone
    }
  }

  /** Keep a mouse-dragged list moving after release, slowing down. */
  private coast(now: number) {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const stillFor = now - last.t;
    let velocity = last.t > first.t && stillFor < 80 ? (last.y - first.y) / (last.t - first.t) : 0;
    if (velocity === 0 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let previous = performance.now();
    const step = (time: number) => {
      const dt = time - previous;
      previous = time;
      this.scroller.scrollTop -= velocity * dt;
      velocity *= Math.pow(0.95, dt / 16);
      if (Math.abs(velocity) > 0.02) this.glide = requestAnimationFrame(step);
    };
    this.glide = requestAnimationFrame(step);
  }
}
