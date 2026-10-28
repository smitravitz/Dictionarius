/**
 * The filter choices, kept in this browser's storage: one key per filter,
 * "dictionarius.<id>" (so safe search keeps its old "dictionarius.safe-search").
 * A switch is stored as "on" or "off"; a range as "min-max", "any" for an open
 * end ("4-any"). Storage can be missing or blocked: then every filter starts
 * on its default, and a choice lasts until the app closes.
 */
import { FILTERS, defaultFilters, type Range } from "../src/filters";

export type FilterValues = Record<string, boolean | Range>;

const storageKey = (id: string) => `dictionarius.${id}`;

/** Each filter's saved choice, or its default. */
export function loadFilters(): FilterValues {
  const values = defaultFilters();
  for (const f of FILTERS) {
    const saved = read(storageKey(f.id));
    if (saved === null) continue;
    if (f.kind === "switch") values[f.id] = saved !== "off";
    else values[f.id] = parseRange(saved);
  }
  return values;
}

/** Remember one filter's choice. */
export function saveFilter(id: string, value: boolean | Range): void {
  write(storageKey(id), typeof value === "boolean" ? (value ? "on" : "off") : value.map((v) => v ?? "any").join("-"));
}

function parseRange(text: string): Range {
  const [min, max] = text.split("-").map((part) => (/^\d+$/.test(part) ? Number(part) : null));
  return [min ?? null, max ?? null];
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not stored; harmless
  }
}
