import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadFilters, saveFilter } from "../web/saved-filters";
import { FILTERS, defaultFilters } from "../src/filters";

// Settings (switches such as safe search) are kept on the device; the funnel's filters
// (ranges such as word length) are not: each start begins on Any.

const switchId = FILTERS.find((f) => f.kind === "switch")!.id;
const rangeId = FILTERS.find((f) => f.kind === "range")!.id;

describe("saved filters", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it("keeps a switch", () => {
    saveFilter(switchId, false);
    expect(loadFilters()[switchId]).toBe(false);
    saveFilter(switchId, true);
    expect(loadFilters()[switchId]).toBe(true);
  });

  it("doesn't keep a range: the next start is on Any", () => {
    saveFilter(rangeId, [4, 6]);
    expect([...store.keys()].some((k) => k.endsWith(rangeId))).toBe(false);
    expect(loadFilters()[rangeId]).toEqual(defaultFilters()[rangeId]);
  });

  it("forgets a range an older version kept", () => {
    store.set(`dictionarius.${rangeId}`, "4-6");
    expect(loadFilters()[rangeId]).toEqual(defaultFilters()[rangeId]);
    expect(store.has(`dictionarius.${rangeId}`)).toBe(false);
  });
});
