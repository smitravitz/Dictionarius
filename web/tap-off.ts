// A tap off the search box puts the keyboard away. Chromium (the Android app) does this by
// itself, but Safari (the iOS app) only does it when the tap lands on something it counts as
// clickable: a tap on plain text, such as the word count, leaves the keyboard up over the
// results. TapOff decides whether a touch was such a tap; main.ts listens and takes the focus
// off the box. The results list isn't its business: it has its own rules for taps while
// typing (scroller-gestures.ts). No DOM here.

/** Longer than this is a long press, not a tap (Android's long press: 400 ms). */
export const TAP_MS = 400;
/** Moving further than this is a drag or a scroll, not a tap (as scroller-gestures.ts). */
const SLOP = 8;

export interface TapOffPress {
  pointerId: number;
  pointerType: string; // "mouse", "touch" or "pen"
  primary: boolean;
  x: number;
  y: number;
  /** When it landed (ms, any clock, the same as up's). */
  at: number;
  /** Landed outside the search box and the results list. */
  outside: boolean;
  /** What it landed on keeps the focus on purpose (it stopped the press's default). */
  claimed: boolean;
  /** The search box has the focus: the keyboard is up. */
  typing: boolean;
}

export class TapOff {
  private press: TapOffPress | null = null;

  down(p: TapOffPress): void {
    if (!p.primary) return; // a second finger: the first one's touch goes on
    // A mouse is left to the browser: every browser takes the focus off on a click.
    const counts = p.pointerType !== "mouse" && p.typing && p.outside && !p.claimed;
    this.press = counts ? p : null;
  }

  move(pointerId: number, x: number, y: number): void {
    const p = this.press;
    if (p && pointerId === p.pointerId && Math.hypot(x - p.x, y - p.y) > SLOP) this.press = null;
  }

  /** The browser took the touch over (a scroll, a system gesture). */
  cancel(pointerId: number): void {
    if (this.press?.pointerId === pointerId) this.press = null;
  }

  /** The touch lifted: true when it was a tap off the box, and the keyboard should go. */
  up(pointerId: number, at: number): boolean {
    const p = this.press;
    if (!p || pointerId !== p.pointerId) return false;
    this.press = null;
    return at - p.at <= TAP_MS;
  }
}
