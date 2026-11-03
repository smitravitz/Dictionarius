import { describe, it, expect } from "vitest";
import { describeRange, FILTERS } from "../src/filters";

// The line under the totals that says which filter is set, so it isn't
// forgotten: one per range filter that isn't on Any.

const length = { label: "Word length", unit: ["letter", "letters"] as const };

describe("describeRange", () => {
  it("says nothing for a range left on Any", () => {
    expect(describeRange(length, [null, null])).toBeNull();
  });

  it("names the filter and its range, in the filter's own unit", () => {
    expect(describeRange(length, [4, 7])).toBe("Word length: 4–7 letters");
    expect(describeRange(length, [4, null])).toBe("Word length: at least 4 letters");
    expect(describeRange(length, [null, 7])).toBe("Word length: up to 7 letters");
    expect(describeRange(length, [5, 5])).toBe("Word length: 5 letters");
    expect(describeRange(length, [1, 1])).toBe("Word length: 1 letter");
    expect(describeRange({ label: "Score" }, [2, 9])).toBe("Score: 2–9");
  });

  it("knows word length's unit", () => {
    const f = FILTERS.find((x) => x.id === "length")!;
    expect(f.kind === "range" && describeRange(f, [3, 4])).toBe("Word length: 3–4 letters");
  });
});
