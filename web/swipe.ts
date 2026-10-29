/**
 * Swipes: a quick sideways flick of one finger anywhere on the screen steps
 * along the trail of words followed (src/trail.ts). Rightward steps back,
 * leftward forward, as pages turn.
 *
 * Only touch flicks count, and only quicker than a hold, so the position
 * slider (a hold, then a slide) and the peek never read as one. Touch events
 * are used because they keep coming while the browser scrolls; a flick that
 * scrolled a row sideways (a long word) was that, not a swipe.
 */
import { HOLD_MS } from "./scroller-gestures";

const MIN_DX = 56; // px sideways, at least
const STEEPEST = 0.5; // up or down by at most half as much as sideways

export type SwipeDirection = "back" | "forward";

export interface Stroke {
  x0: number;
  y0: number;
  t0: number;
  x1: number;
  y1: number;
  t1: number;
}

/** What a finger's stroke from (x0, y0) to (x1, y1) means, if anything. */
export function swipeOf(s: Stroke, { scrolled = false } = {}): SwipeDirection | null {
  const dx = s.x1 - s.x0;
  const dy = s.y1 - s.y0;
  if (scrolled || s.t1 - s.t0 >= HOLD_MS) return null;
  if (Math.abs(dx) < MIN_DX || Math.abs(dy) > Math.abs(dx) * STEEPEST) return null;
  return dx > 0 ? "back" : "forward";
}

/** Watches one finger's strokes on `target` and reports swipes. */
export class Swipes {
  private start: { x: number; y: number; t: number; row: Element | null; left: number } | null = null;

  constructor(
    target: EventTarget,
    private readonly swiped: (direction: SwipeDirection) => void,
  ) {
    target.addEventListener("touchstart", (e) => this.down(e as TouchEvent), { passive: true });
    target.addEventListener("touchend", (e) => this.up(e as TouchEvent), { passive: true });
    target.addEventListener("touchcancel", () => (this.start = null), { passive: true });
  }

  private down(e: TouchEvent) {
    if (e.touches.length !== 1) {
      this.start = null; // a second finger: a pinch, not a swipe
      return;
    }
    const touch = e.touches[0];
    const row = (e.target as Element).closest?.(".track") ?? null; // a row that scrolls sideways
    this.start = { x: touch.clientX, y: touch.clientY, t: e.timeStamp, row, left: row?.scrollLeft ?? 0 };
  }

  private up(e: TouchEvent) {
    const start = this.start;
    this.start = null;
    if (!start || e.touches.length > 0) return;
    const touch = e.changedTouches[0];
    const stroke = { x0: start.x, y0: start.y, t0: start.t, x1: touch.clientX, y1: touch.clientY, t1: e.timeStamp };
    const direction = swipeOf(stroke, { scrolled: !!start.row && start.row.scrollLeft !== start.left });
    if (direction) this.swiped(direction);
  }
}
