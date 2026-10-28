import type { SafeSearchOverrides } from "./complete";
import { normalize } from "./normalize";
import list from "../data/safe-search.list?raw";

/**
 * Safe search's hand-picked list (data/safe-search.list): words to allow or
 * block on top of the rule in docs/index-format.md#safe-search. The index
 * builder applies it too; applying it again here means an edit reaches the
 * app without rebuilding the index. Words are stored encoded (ROT13, then
 * base64) so the file isn't a readable word list; scripts/safe_search_list.py
 * shows and edits it.
 */

const rot13 = (s: string) =>
  s.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });

/** One encoded word of the list. */
export function decodeEntry(token: string): string {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(token)) throw new Error("not an encoded word");
  const bytes = Uint8Array.from(atob(token), (c) => c.charCodeAt(0));
  return rot13(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** The encoded form of a word (the inverse of decodeEntry). */
export function encodeEntry(word: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(rot13(word))));
}

/** Read the list: "[allow]" and "[block]" sections of encoded words, one per
 *  line; "#" starts a comment line. Words come back decoded and normalized. */
export function parseSafeSearchList(text: string): Required<SafeSearchOverrides> {
  const allow: string[] = [];
  const block: string[] = [];
  let section: string[] | null = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    if (line === "[allow]" || line === "[block]") section = line === "[allow]" ? allow : block;
    else if (!section) throw new Error(`line ${i + 1}: an entry before [allow] or [block]`);
    else {
      try {
        section.push(normalize(decodeEntry(line)));
      } catch {
        throw new Error(`line ${i + 1}: not an encoded word`);
      }
    }
  });
  const both = allow.filter((w) => block.includes(w));
  if (both.length) throw new Error(`${both.length} word(s) both allowed and blocked`);
  return { allow, block };
}

export const SAFE_SEARCH_OVERRIDES: SafeSearchOverrides = parseSafeSearchList(list);
