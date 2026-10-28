import { describe, it, expect } from "vitest";
import { PressClassifier, type PressStart } from "../web/scroller-gestures";

// What a press on the results list means. The classifier hears the press start,
// moves, the hold timer and the release, says what to do at each step, and
// rules on the click that follows: let it open the word, swallow it, or
// swallow it and put the keyboard away.

const press = (over: Partial<PressStart> = {}): PressStart => ({
  pointerId: 1,
  pointerType: "touch",
  primary: true,
  button: 0,
  x: 100,
  y: 200,
  onWord: true,
  onRow: true,
  typing: false,
  ...over,
});

describe("PressClassifier", () => {
  it("lets a tap open the word under it", () => {
    const c = new PressClassifier();
    c.down(press());
    expect(c.move(1, 103, 201)).toBeNull(); // a wobble isn't a move
    expect(c.up(1)).toBeNull();
    expect(c.click()).toBe("open");
  });

  it("puts the keyboard away instead when a finger taps while typing", () => {
    const c = new PressClassifier();
    c.down(press({ typing: true }));
    c.up(1);
    expect(c.click()).toBe("dismiss-keyboard");
    c.down(press()); // the keyboard is gone: the next tap opens
    c.up(1);
    expect(c.click()).toBe("open");
  });

  it("lets a mouse click open a word even while typing", () => {
    const c = new PressClassifier();
    c.down(press({ pointerType: "mouse", typing: true }));
    c.up(1);
    expect(c.click()).toBe("open");
  });

  it("opens the slider on a hold of a blank spot, follows the finger, and closes on release", () => {
    const c = new PressClassifier();
    c.down(press({ onWord: false, x: 40 }));
    expect(c.holdDue).toBe(true);
    expect(c.hold()).toEqual({ type: "hold", x: 40 });
    expect(c.move(1, 120, 205)).toEqual({ type: "slide", x: 120 });
    expect(c.move(1, 300, 260)).toEqual({ type: "slide", x: 300 }); // any direction, any distance
    expect(c.up(1)).toEqual({ type: "release" });
    expect(c.click()).toBe("suppress");
  });

  it("reports a hold on a word, and doesn't let it open the word", () => {
    const c = new PressClassifier();
    c.down(press({ onWord: true }));
    expect(c.hold()).toEqual({ type: "hold-word" });
    expect(c.up(1)).toBeNull();
    expect(c.click()).toBe("suppress");
  });

  it("cancels the hold once the finger moves: that's scrolling", () => {
    const c = new PressClassifier();
    c.down(press({ onWord: false }));
    expect(c.move(1, 100, 230)).toEqual({ type: "cancel-hold" });
    expect(c.holdDue).toBe(false);
    expect(c.hold()).toBeNull();
    expect(c.move(1, 100, 260)).toBeNull(); // the browser scrolls a finger's list itself
    expect(c.up(1)).toBeNull();
    expect(c.click()).toBe("suppress");
  });

  it("drags the list with the mouse up and down, and a row sideways", () => {
    const list = new PressClassifier();
    list.down(press({ pointerType: "mouse", y: 200 }));
    expect(list.move(1, 102, 170)).toEqual({ type: "drag", axis: "list", dx: 2, dy: -30 });
    expect(list.move(1, 140, 150)).toEqual({ type: "drag", axis: "list", dx: 40, dy: -50 }); // stays a list drag
    expect(list.up(1)).toEqual({ type: "drop", axis: "list" });
    expect(list.click()).toBe("suppress");

    const row = new PressClassifier();
    row.down(press({ pointerType: "mouse", x: 100 }));
    expect(row.move(1, 70, 203)).toEqual({ type: "drag", axis: "row", dx: -30, dy: 3 });
    expect(row.up(1)).toEqual({ type: "drop", axis: "row" });

    const offRow = new PressClassifier(); // sideways, but not on a row: the list
    offRow.down(press({ pointerType: "mouse", onRow: false, onWord: false }));
    expect(offRow.move(1, 130, 201)).toEqual({ type: "drag", axis: "list", dx: 30, dy: 1 });
  });

  it("ignores other buttons, second fingers and stray events", () => {
    const c = new PressClassifier();
    c.down(press({ pointerType: "mouse", button: 2 }));
    expect(c.holdDue).toBe(false);
    c.down(press({ pointerId: 1 }));
    c.down(press({ pointerId: 2, primary: false, typing: true })); // a second finger
    expect(c.move(2, 0, 0)).toBeNull();
    expect(c.up(2)).toBeNull();
    c.up(1);
    expect(c.click()).toBe("open");
  });

  it("lets a click with no press before it through (a keyboard or screen reader)", () => {
    const c = new PressClassifier();
    expect(c.click()).toBe("open");
    c.down(press());
    c.up(1);
    c.click();
    expect(c.click()).toBe("open"); // each verdict is used once
  });

  it("forgets a press the browser cancelled", () => {
    const c = new PressClassifier();
    c.down(press({ onWord: false }));
    c.hold();
    expect(c.cancel(1)).toEqual({ type: "release" });
    expect(c.click()).toBe("suppress");
  });
});
