/**
 * Words from an outside bad-word list that safe search still shows: candidates
 * for the hand-picked block list (data/safe-search.list). Prints them most
 * common first. A person decides; most such lists also hold everyday words
 * ("welfare", "kumquat") and names.
 *
 *   npx vite-node scripts/safe-search-candidates.ts words.txt [dist/headwords.bin]
 *
 * The list is a text file, one word per line, or a JavaScript module exporting
 * a map of word -> rating, like cuss (MIT, github.com/wooorm/cuss), where 2
 * means "likely profane": only those are read.
 *
 *   npm pack cuss && tar xzf cuss-*.tgz
 *   npx vite-node scripts/safe-search-candidates.ts package/index.js
 *
 * Add the ones that are bad words with
 * python scripts/safe_search_list.py add block WORD ...
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HeadwordIndex } from "../src/headword-index";
import { normalize } from "../src/normalize";
import { parseSafeSearchList } from "../src/safe-search-overrides";

const [listPath, indexPath = "dist/headwords.bin"] = process.argv.slice(2);
if (!listPath) {
  console.error("usage: npx vite-node scripts/safe-search-candidates.ts <list.txt | list.js> [headwords.bin]");
  process.exit(2);
}

async function readList(path: string): Promise<string[]> {
  if (/\.[cm]?js$/.test(path)) {
    const module = await import(resolve(path));
    const map = Object.values(module).find((v) => v && typeof v === "object") as Record<string, number>;
    return Object.entries(map)
      .filter(([, rating]) => rating >= 2)
      .map(([word]) => word);
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

const index = HeadwordIndex.fromBytes(new Uint8Array(readFileSync(indexPath)));
const lists = parseSafeSearchList(readFileSync("data/safe-search.list", "utf8"));
const block = new Set(lists.block);
const allow = new Set(lists.allow);

const tally = { absent: 0, hidden: 0, allowed: 0 };
const shown: { zipf: number; word: string }[] = [];
for (const word of await readList(listPath)) {
  const key = normalize(word);
  const id = index.exact(key);
  if (id === null) tally.absent++;
  else if (allow.has(key)) tally.allowed++;
  else if (index.isExplicit(id) || block.has(key)) tally.hidden++;
  else shown.push({ zipf: index.frequency(id), word: index.displayForms(id)[0] });
}
shown.sort((a, b) => b.zipf - a.zipf || a.word.localeCompare(b.word));
for (const { zipf, word } of shown) console.log(`${zipf.toFixed(2)}\t${word}`);
console.error(
  `${shown.length} still shown; ${tally.hidden} hidden already, ${tally.allowed} allowed on purpose, ` +
    `${tally.absent} not in the word list`,
);
