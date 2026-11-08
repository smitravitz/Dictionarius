/**
 * Whether the person is busy with the app: a finger (or mouse button) down, or something
 * done lately (a press, a lift, a key, the wheel, a scroll). The first-run tour waits for
 * them to be still before it shows anything new or acts anything out, so it never talks
 * over what they're doing. Heard first, on the window, before anything else hears it.
 */
export class Hands {
  private readonly down = new Set<number>();
  private last = -Infinity; // when they last did anything

  constructor(
    on: EventTarget = window,
    private readonly now: () => number = () => performance.now(),
  ) {
    const did = () => (this.last = now());
    on.addEventListener("pointerdown", (event) => {
      this.down.add((event as PointerEvent).pointerId);
      did();
    }, true);
    for (const type of ["pointerup", "pointercancel"]) {
      on.addEventListener(type, (event) => {
        this.down.delete((event as PointerEvent).pointerId);
        did();
      }, true);
    }
    for (const type of ["keydown", "wheel", "scroll"]) on.addEventListener(type, did, { capture: true, passive: true });
    on.addEventListener("blur", () => this.down.clear()); // a lift elsewhere is never heard
  }

  /** A finger or button is down now. */
  get busy(): boolean {
    return this.down.size > 0;
  }

  /** Whether they did anything after `time` (a `now()` reading). */
  since(time: number): boolean {
    return this.last > time;
  }

  /** Calls `fn` once nothing is down and nothing has been done for `ms`, unless stopped first. */
  whenStill(ms: number, signal: AbortSignal, fn: () => void) {
    let timer: ReturnType<typeof setTimeout>;
    const look = () => {
      if (signal.aborted) return;
      const quiet = this.now() - this.last;
      if (!this.busy && quiet >= ms) return fn();
      timer = setTimeout(look, this.busy ? 100 : ms - quiet);
    };
    timer = setTimeout(look, 0);
    signal.addEventListener("abort", () => clearTimeout(timer));
  }
}
