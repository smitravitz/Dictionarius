/**
 * A roller wheel: a column of values, the middle row being the choice. Turned
 * by dragging up and down (a flick carries on), by a mouse wheel, or by the
 * arrow keys when focused, so no on-screen keyboard is involved. Each row it
 * passes ticks. Where it lands: wheel-model.ts.
 */
import { tick } from "./haptics";
import { landing } from "./wheel-model";

const ROW = 36; // px per row; keep in step with .wheel's --wheel-row in styles.css
const MIDDLE = 2; // rows above the middle one (five in view)
const SETTLE = "transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)";

export class Wheel {
  readonly el: HTMLElement;
  private readonly track: HTMLElement;
  private options: (number | null)[] = [null];
  private index = 0;
  private drag: { id: number; y: number; from: number; row: number; samples: { t: number; y: number }[] } | null = null;
  private wheelDelta = 0;

  constructor(
    label: string,
    /** A new value was chosen (not called by set()). */
    private readonly choose: (value: number | null) => void,
  ) {
    this.el = document.createElement("div");
    this.el.className = "wheel";
    this.el.tabIndex = 0;
    this.el.setAttribute("role", "spinbutton");
    this.el.setAttribute("aria-label", label);
    this.el.dataset.rowHeight = String(ROW);
    this.track = document.createElement("ol");
    this.track.className = "wheel-track";
    this.track.setAttribute("aria-hidden", "true");
    this.el.append(this.track);

    this.el.addEventListener("pointerdown", (e) => this.down(e));
    this.el.addEventListener("pointermove", (e) => this.move(e));
    this.el.addEventListener("pointerup", (e) => this.up(e));
    this.el.addEventListener("pointercancel", (e) => this.up(e));
    this.el.addEventListener("wheel", (e) => this.scroll(e), { passive: false });
    this.el.addEventListener("keydown", (e) => this.key(e));
  }

  get value(): number | null {
    return this.options[this.index];
  }

  /** Offer `options` and land on `value` (Any when it isn't offered). */
  set(options: (number | null)[], value: number | null): void {
    this.options = options;
    this.index = Math.max(0, options.indexOf(value));
    this.track.replaceChildren(
      ...options.map((v) => {
        const row = document.createElement("li");
        row.textContent = v === null ? "Any" : String(v);
        return row;
      }),
    );
    this.draw(this.index, false);
    this.describe();
  }

  private down(e: PointerEvent) {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault(); // no text selection, no focus fight
    this.el.focus({ preventScroll: true });
    this.el.setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, y: e.clientY, from: this.index, row: this.index, samples: [{ t: e.timeStamp, y: e.clientY }] };
  }

  private move(e: PointerEvent) {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.id) return;
    const last = this.options.length - 1;
    // Past either end the wheel gives a little, then stops.
    const at = Math.min(last + 0.4, Math.max(-0.4, drag.from - (e.clientY - drag.y) / ROW));
    this.draw(at, false);
    const row = Math.min(last, Math.max(0, Math.round(at)));
    if (row !== drag.row) {
      drag.row = row;
      tick();
    }
    drag.samples.push({ t: e.timeStamp, y: e.clientY });
    if (drag.samples.length > 6) drag.samples.shift();
  }

  private up(e: PointerEvent) {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.id) return;
    this.drag = null;
    // Speed over the last moments of the drag; none if the finger rested.
    const recent = drag.samples.filter((s) => e.timeStamp - s.t < 100);
    const first = recent[0];
    const velocity = recent.length > 1 && e.timeStamp > first.t ? (e.clientY - first.y) / (e.timeStamp - first.t) : 0;
    this.go(landing(drag.from, e.clientY - drag.y, velocity, ROW, this.options.length), true);
  }

  private scroll(e: WheelEvent) {
    e.preventDefault();
    this.wheelDelta += e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY : e.deltaY * ROW;
    const rows = Math.trunc(this.wheelDelta / ROW);
    if (rows === 0) return;
    this.wheelDelta -= rows * ROW;
    this.go(this.index + rows, true, true);
  }

  private key(e: KeyboardEvent) {
    const last = this.options.length - 1;
    const to: Record<string, number> = {
      ArrowUp: this.index + 1, // up means more, as for any spin button
      ArrowDown: this.index - 1,
      PageUp: this.index + 5,
      PageDown: this.index - 5,
      Home: 0,
      End: last,
    };
    if (!(e.key in to)) return;
    e.preventDefault();
    this.go(to[e.key], true, true);
  }

  /** Land on row `i`, and say so when that's a new value. */
  private go(i: number, animate: boolean, ticks = false) {
    const row = Math.min(this.options.length - 1, Math.max(0, i));
    this.draw(row, animate);
    if (row === this.index) return;
    this.index = row;
    if (ticks) tick();
    this.describe();
    this.choose(this.value);
  }

  /** Draw the wheel turned so row `at` (fractional while dragging) is in the middle. */
  private draw(at: number, animate: boolean) {
    const still = animate && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.track.style.transition = still ? SETTLE : "none";
    this.track.style.transform = `translateY(${(MIDDLE - at) * ROW}px)`;
    const rows = this.track.children;
    const middle = Math.round(at);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as HTMLElement;
      const d = i - at;
      if (Math.abs(d) > MIDDLE + 1.5) {
        row.style.visibility = "hidden";
        continue;
      }
      // A drum: rows tilt away and fade as they leave the middle.
      row.style.visibility = "";
      row.style.transition = still ? "transform 0.22s ease-out, opacity 0.22s ease-out" : "none";
      row.style.transform = `rotateX(${-d * 17}deg)`;
      row.style.opacity = String(Math.max(0.2, 1 - Math.abs(d) * 0.27));
      row.classList.toggle("on", i === middle);
    }
  }

  private describe() {
    const value = this.value;
    this.el.setAttribute("aria-valuetext", value === null ? "Any" : String(value));
    if (value === null) this.el.removeAttribute("aria-valuenow");
    else this.el.setAttribute("aria-valuenow", String(value));
  }
}
