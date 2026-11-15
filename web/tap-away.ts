/**
 * A finger's tap anywhere off the search box puts its keyboard away, and with it the box's
 * selection (main.ts drops that on blur). Chromium does this by itself; Safari's engine
 * leaves the box focused when the tap lands on something that takes no focus (the word
 * count, a heading, a page's text), so the keyboard would stay up over the page.
 *
 * - Only a tap: a finger that scrolls ends in pointercancel, and the keyboard stays.
 * - Not where something has its own rule: the box itself, the results list (a tap there
 *   only puts the keyboard away, decided in scroller-gestures.ts), and a press whose
 *   pointerdown was cancelled to keep the focus (the box's clearing cross).
 * - Not the mouse: browsers already move the focus on mousedown.
 */
export interface TapAwayEvents {
  /** The search box has focus: on a touch screen, its keyboard is up. */
  typing(): boolean;
  /** Where the press landed handles the keyboard itself. */
  ownRule(target: EventTarget | null): boolean;
  dismissKeyboard(): void;
}

export class TapAway {
  private pressed: number | null = null; // the pointer of a tap that may put the keyboard away

  constructor(on: EventTarget, events: TapAwayEvents) {
    on.addEventListener("pointerdown", (event) => {
      const press = event as PointerEvent;
      const taps = press.pointerType !== "mouse" && !press.defaultPrevented && events.typing() && !events.ownRule(press.target);
      this.pressed = taps ? press.pointerId : null;
    });
    on.addEventListener("pointerup", (event) => {
      if (this.pressed === null || (event as PointerEvent).pointerId !== this.pressed) return;
      this.pressed = null;
      events.dismissKeyboard();
    });
    on.addEventListener("pointercancel", (event) => {
      if ((event as PointerEvent).pointerId === this.pressed) this.pressed = null; // a scroll
    });
  }
}
