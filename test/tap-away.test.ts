import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { TapAway } from "../web/tap-away";

// A finger's tap anywhere off the search box puts its keyboard away. Chromium does that by
// itself; Safari's engine leaves the box focused when the tap lands on something that takes
// no focus (text, a heading), so the app does it.

const pointer = (on: EventTarget, type: string, pointerType = "touch", pointerId = 1) => {
  const event = Object.assign(new Event(type, { cancelable: true }), { pointerId, pointerType });
  on.dispatchEvent(event);
  return event;
};

describe("a tap away from the search box", () => {
  let page: EventTarget;
  let typing: boolean;
  let ownRule: Mock<(target: EventTarget | null) => boolean>;
  let dismissKeyboard: Mock<() => void>;
  beforeEach(() => {
    page = new EventTarget();
    typing = true;
    ownRule = vi.fn((_target: EventTarget | null) => false);
    dismissKeyboard = vi.fn(() => {});
    new TapAway(page, { typing: () => typing, ownRule, dismissKeyboard });
  });

  it("puts the keyboard away once the finger lifts", () => {
    pointer(page, "pointerdown");
    expect(dismissKeyboard).not.toHaveBeenCalled(); // not yet: it may be a scroll
    pointer(page, "pointerup");
    expect(dismissKeyboard).toHaveBeenCalledTimes(1);
  });

  it("leaves it up when the finger scrolled instead", () => {
    pointer(page, "pointerdown");
    pointer(page, "pointercancel"); // the browser took the touch for a scroll
    pointer(page, "pointerup");
    expect(dismissKeyboard).not.toHaveBeenCalled();
  });

  it("leaves it to what has its own rule: the box itself, the results list", () => {
    ownRule.mockReturnValue(true);
    pointer(page, "pointerdown");
    pointer(page, "pointerup");
    expect(ownRule).toHaveBeenCalledWith(page); // asked about where the press landed
    expect(dismissKeyboard).not.toHaveBeenCalled();
  });

  it("leaves it up for a press that keeps the focus (the clearing cross)", () => {
    const fresh = new EventTarget();
    fresh.addEventListener("pointerdown", (event) => event.preventDefault()); // the cross hears it first
    new TapAway(fresh, { typing: () => true, ownRule: () => false, dismissKeyboard });
    pointer(fresh, "pointerdown");
    pointer(fresh, "pointerup");
    expect(dismissKeyboard).not.toHaveBeenCalled();
  });

  it("leaves a mouse to the browser", () => {
    pointer(page, "pointerdown", "mouse");
    pointer(page, "pointerup", "mouse");
    expect(dismissKeyboard).not.toHaveBeenCalled();
  });

  it("does nothing when nobody is typing", () => {
    typing = false;
    pointer(page, "pointerdown");
    pointer(page, "pointerup");
    expect(dismissKeyboard).not.toHaveBeenCalled();
  });

  it("goes by the finger that pressed: another lifting doesn't count", () => {
    pointer(page, "pointerdown", "touch", 1);
    pointer(page, "pointerup", "touch", 2);
    expect(dismissKeyboard).not.toHaveBeenCalled();
    pointer(page, "pointerup", "touch", 1);
    expect(dismissKeyboard).toHaveBeenCalledTimes(1);
  });
});
