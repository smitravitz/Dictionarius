import type { SafeSearchOverrides } from "./complete";
import { normalize } from "./normalize";
import list from "../data/safe-search.txt?raw";

/**
 * Safe search's hand corrections (data/safe-search.txt). The index builder
 * applies them too, with inflections; applying them again here means an edit
 * reaches the app without rebuilding the index.
 */

/** Read a corrections list: "[allow]" and "[block]" sections, one word per
 *  line, "#" starts a comment line. Words come back normalized. */
export function parseSafeSearchList(text: string): Required<SafeSearchOverrides> {
  const allow: string[] = [];
  const block: string[] = [];
  let section: string[] | null = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    if (line === "[allow]" || line === "[block]") section = line === "[allow]" ? allow : block;
    else if (!section) throw new Error(`line ${i + 1}: "${line}" comes before [allow] or [block]`);
    else section.push(normalize(line));
  });
  const both = allow.filter((w) => block.includes(w));
  if (both.length) throw new Error(`both allowed and blocked: ${both.join(", ")}`);
  return { allow, block };
}

export const SAFE_SEARCH_OVERRIDES: SafeSearchOverrides = parseSafeSearchList(list);
