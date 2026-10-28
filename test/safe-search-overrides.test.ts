import { describe, it, expect } from "vitest";
import { parseSafeSearchList, SAFE_SEARCH_OVERRIDES } from "../src/safe-search-overrides";

describe("safe search corrections list", () => {
  it("reads sections, skips comments and blank lines, and normalizes words", () => {
    const list = parseSafeSearchList("# a comment\n\n[allow]\nBoy\n  fun run  \nCafé\n[block]\n# why\nGapword\n");
    expect(list).toEqual({ allow: ["boy", "fun run", "cafe"], block: ["gapword"] });
  });

  it("rejects a word outside a section, or in both", () => {
    expect(() => parseSafeSearchList("boy\n[allow]\n")).toThrow(/before \[allow\] or \[block\]/);
    expect(() => parseSafeSearchList("[allow]\nboy\n[block]\nBoy\n")).toThrow(/both allowed and blocked: boy/);
  });

  it("ships data/safe-search.txt", () => {
    expect(SAFE_SEARCH_OVERRIDES.allow).toContain("it");
    expect(SAFE_SEARCH_OVERRIDES.block?.length).toBeGreaterThan(0);
  });
});
