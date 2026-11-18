import { describe, it, expect } from "vitest";
import { spreadBands } from "../web/spread-bands";

// The slider's spread bands: dotted lines where the middle 68.3% and 95.4% of the words begin
// and end, and the share of the words in each band. Positions are continuous: bar n spans n to
// n + 1, its words spread evenly across it, so a line can fall partway through a bar. Expected
// values below are worked by hand from that rule, not taken from the code.

describe("spreadBands", () => {
  it("puts every line inside the one bar that holds all the words", () => {
    // 10 words, all at position 1: the q-th share is reached at 1 + q.
    const bands = spreadBands([0, 10, 0])!;
    expect(bands.lines).toHaveLength(4);
    expect(bands.lines[0]).toBeCloseTo(1.02275, 5);
    expect(bands.lines[1]).toBeCloseTo(1.15865, 5);
    expect(bands.lines[2]).toBeCloseTo(1.84135, 5);
    expect(bands.lines[3]).toBeCloseTo(1.97725, 5);
  });

  it("follows a lopsided list instead of centring on its mean", () => {
    // 80 words at 0 letters, 20 at 1. The lower lines fall in bar 0 (2.275 and 15.865 words
    // in, of its 80); the upper two in bar 1 (84.135 - 80 = 4.135 and 17.725 of its 20).
    const bands = spreadBands([80, 20])!;
    expect(bands.lines[0]).toBeCloseTo(2.275 / 80, 6);
    expect(bands.lines[1]).toBeCloseTo(15.865 / 80, 6);
    expect(bands.lines[2]).toBeCloseTo(1 + 4.135 / 20, 6);
    expect(bands.lines[3]).toBeCloseTo(1 + 17.725 / 20, 6);
  });

  it("skips empty positions between the words", () => {
    // 50 words at 0 and 50 at 3: the middle never lands in the empty bars 1 and 2.
    const bands = spreadBands([50, 0, 0, 50])!;
    expect(bands.lines[1]).toBeCloseTo(15.865 / 50, 6);
    expect(bands.lines[2]).toBeCloseTo(3 + 34.135 / 50, 6);
  });

  it("labels the middle band 68.3% and each side band 13.6%", () => {
    expect(spreadBands([1, 2, 3])!.labels).toStrictEqual(["13.6%", "68.3%", "13.6%"]);
  });

  it("draws nothing for a list with no words", () => {
    expect(spreadBands([])).toBeNull();
    expect(spreadBands([0, 0])).toBeNull();
  });
});
