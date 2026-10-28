import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  decodeEntry,
  encodeEntry,
  parseSafeSearchList,
  SAFE_SEARCH_OVERRIDES,
} from "../src/safe-search-overrides";

const list = (allow: string[], block: string[], contains?: string[]) =>
  [
    "# a comment",
    "",
    "[allow]",
    ...allow.map(encodeEntry),
    "[block]",
    "# why",
    ...block.map(encodeEntry),
    ...(contains ? ["[contains]", ...contains.map(encodeEntry)] : []),
    "",
  ].join("\n");

describe("safe search's hand-picked list", () => {
  it("reads encoded sections, skips comments, and normalizes words", () => {
    expect(parseSafeSearchList(list(["Boy", "fun run", "Café"], ["Gapword"], ["Gapp"]))).toEqual({
      allow: ["boy", "fun run", "cafe"],
      block: ["gapword"],
      contains: ["gapp"],
    });
    expect(parseSafeSearchList(list(["boy"], []))).toEqual({ allow: ["boy"], block: [], contains: [] });
  });

  it("decodes what the Python script encodes", () => {
    const encoded = execFileSync("python3", ["-c", "import sys; sys.path.insert(0, 'scripts'); import safe_search_list as l; print(l.encode('Café Zebra-Ünder'))"])
      .toString()
      .trim();
    expect(encoded).toBe(encodeEntry("Café Zebra-Ünder"));
    expect(decodeEntry(encoded)).toBe("Café Zebra-Ünder");
  });

  it("rejects an entry outside a section, a plain word, or a word in both", () => {
    expect(() => parseSafeSearchList(`${encodeEntry("boy")}\n[allow]\n`)).toThrow(/before a section/);
    expect(() => parseSafeSearchList("[block]\nnot encoded!\n")).toThrow(/not an encoded word/);
    expect(() => parseSafeSearchList(list(["boy"], ["Boy"]))).toThrow(/both allowed and blocked/);
  });

  it("ships data/safe-search.list", () => {
    expect(SAFE_SEARCH_OVERRIDES.allow?.length).toBeGreaterThan(0);
    expect(SAFE_SEARCH_OVERRIDES.block?.length).toBeGreaterThan(0);
    expect(SAFE_SEARCH_OVERRIDES.contains?.length).toBeGreaterThan(0);
  });
});
