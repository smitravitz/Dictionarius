import { describe, it, expect } from "vitest";
import { TAP_MS, TapOff, type TapOffPress } from "../web/tap-off";

// A tap off the search box puts the keyboard away. Chromium (the Android app) does this by
// itself; Safari (the iOS app) doesn't when the tap lands on plain text, such as the word
// count, so the keyboard stays up over the results. TapOff decides, from a touch's start,
// moves and lift, whether it was such a tap: short, still, outside the box and the list
// (which has its own rules), and not claimed by what it landed on.

const touch = (over: Partial<TapOffPress> = {}): TapOffPress => ({
  pointerId: 1,
  pointerType: "touch",
  primary: true,
  x: 100,
  y: 200,
  at: 0,
  outside: true,
  claimed: false,
  typing: true,
  ...over,
});

describe("TapOff", () => {
  it("puts the keyboard away after a tap on plain text outside the box", () => {
    const t = new TapOff();
    t.down(touch());
    t.move(1, 103, 202); // a wobble isn't a move
    expect(t.up(1, 120)).toBe(true);
  });

  it("leaves it up when nothing is being typed", () => {
    const t = new TapOff();
    t.down(touch({ typing: false }));
    expect(t.up(1, 120)).toBe(false);
  });

  it("leaves it to the box, and to the list's own rules, when the tap lands on either", () => {
    const t = new TapOff();
    t.down(touch({ outside: false }));
    expect(t.up(1, 120)).toBe(false);
  });

  it("leaves it up when what was tapped keeps the focus on purpose (the clear button)", () => {
    const t = new TapOff();
    t.down(touch({ claimed: true }));
    expect(t.up(1, 120)).toBe(false);
  });

  it("leaves it up after a drag, a long press or a cancelled touch, as Chromium does", () => {
    const dragged = new TapOff();
    dragged.down(touch());
    dragged.move(1, 100, 240);
    expect(dragged.up(1, 120)).toBe(false);

    const held = new TapOff();
    held.down(touch());
    expect(held.up(1, TAP_MS + 1)).toBe(false);

    const cancelled = new TapOff();
    cancelled.down(touch());
    cancelled.cancel(1);
    expect(cancelled.up(1, 120)).toBe(false);
  });

  it("follows one touch: a second finger, or a lift of another, changes nothing", () => {
    const t = new TapOff();
    t.down(touch());
    t.down(touch({ pointerId: 2, primary: false }));
    expect(t.up(2, 100)).toBe(false);
    expect(t.up(1, 120)).toBe(true);
  });

  it("leaves a mouse to the browser, which already does this for a click", () => {
    const t = new TapOff();
    t.down(touch({ pointerType: "mouse" }));
    expect(t.up(1, 120)).toBe(false);
  });

  it("counts each tap once", () => {
    const t = new TapOff();
    t.down(touch());
    expect(t.up(1, 120)).toBe(true);
    expect(t.up(1, 130)).toBe(false);
  });
});
