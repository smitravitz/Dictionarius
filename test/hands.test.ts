import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hands } from "../web/hands";

// Whether the person is busy with the app: a finger (or button) down, or something done
// lately. The tour waits for them to be still before it shows anything new.

const press = (on: EventTarget, type: string, pointerId = 1) => on.dispatchEvent(Object.assign(new Event(type), { pointerId }));

describe("hands", () => {
  let window_: EventTarget;
  let hands: Hands;
  beforeEach(() => {
    vi.useFakeTimers();
    window_ = new EventTarget();
    hands = new Hands(window_, () => Date.now());
  });
  afterEach(() => vi.useRealTimers());

  it("is busy while a finger is down, and not once it's lifted", () => {
    expect(hands.busy).toBe(false);
    press(window_, "pointerdown");
    expect(hands.busy).toBe(true);
    press(window_, "pointerdown", 2); // a second finger
    press(window_, "pointerup", 1);
    expect(hands.busy).toBe(true);
    press(window_, "pointercancel", 2);
    expect(hands.busy).toBe(false);
  });

  it("waits for the finger to lift, then for a still moment, before going on", () => {
    const go = vi.fn();
    press(window_, "pointerdown");
    hands.whenStill(600, new AbortController().signal, go);
    vi.advanceTimersByTime(5000); // held for five seconds: still waiting
    expect(go).not.toHaveBeenCalled();
    press(window_, "pointerup");
    vi.advanceTimersByTime(500);
    expect(go).not.toHaveBeenCalled(); // just let go
    vi.advanceTimersByTime(150);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("counts keys, the wheel and scrolling as busy too", () => {
    const go = vi.fn();
    window_.dispatchEvent(new Event("keydown")); // typing
    hands.whenStill(600, new AbortController().signal, go);
    for (const type of ["keydown", "wheel", "scroll"]) {
      vi.advanceTimersByTime(400);
      window_.dispatchEvent(new Event(type));
    }
    vi.advanceTimersByTime(400);
    expect(go).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("goes on at once when the person is already still", () => {
    const go = vi.fn();
    vi.advanceTimersByTime(1000);
    hands.whenStill(600, new AbortController().signal, go);
    vi.advanceTimersByTime(0);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("doesn't go on once stopped", () => {
    const go = vi.fn();
    const stop = new AbortController();
    press(window_, "pointerdown");
    hands.whenStill(600, stop.signal, go);
    stop.abort();
    press(window_, "pointerup");
    vi.advanceTimersByTime(5000);
    expect(go).not.toHaveBeenCalled();
  });

  it("forgets fingers when the app loses the screen (their lifting is never heard)", () => {
    press(window_, "pointerdown");
    window_.dispatchEvent(new Event("blur"));
    expect(hands.busy).toBe(false);
  });

  it("tells whether anything was done since a moment", () => {
    const then = Date.now();
    vi.advanceTimersByTime(100);
    expect(hands.since(then)).toBe(false);
    window_.dispatchEvent(new Event("keydown"));
    expect(hands.since(then)).toBe(true);
  });
});
