/**
 * The settings among the filters (the switches, such as safe search), kept in this
 * browser's storage: one key per switch, "dictionarius.<id>" (so safe search keeps its
 * old "dictionarius.safe-search"), "on" or "off". The funnel's filters (the ranges, such
 * as word length) are not kept: every start begins on Any, and a range an older version
 * kept is forgotten. Storage can be missing or blocked: then every switch starts on its
 * default, and a choice lasts until the app closes.
 */
import { FILTERS, defaultFilters, type Range } from "../src/filters";

export type FilterValues = Record<string, boolean | Range>;

const storageKey = (id: string) => `dictionarius.${id}`;

/** Each switch's saved choice, or its default; every range on its default. */
export function loadFilters(): FilterValues {
  const values = defaultFilters();
  for (const f of FILTERS) {
    if (f.kind !== "switch") {
      remove(storageKey(f.id)); // kept by an older version
      continue;
    }
    const saved = read(storageKey(f.id));
    if (saved !== null) values[f.id] = saved !== "off";
  }
  return values;
}

/** Remember a switch's choice (a range isn't kept). */
export function saveFilter(id: string, value: boolean | Range): void {
  if (typeof value === "boolean") write(storageKey(id), value ? "on" : "off");
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing to forget
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not stored; harmless
  }
}
