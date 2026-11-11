/**
 * How fast the app's search answers, on a word list: for every single letter and every
 * start-screen suggestion, the time to the first screen of results (50 rows, what the
 * page shows first) and to every match counted (the totals and the frequency graph).
 * The app's own search code, as the search worker runs it. Run: npm run bench:speed
 */
import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import { HeadwordIndex } from "../src/headword-index";
import { Completer } from "../src/complete";
import { defaultFilters } from "../src/filters";
import { SAFE_SEARCH_OVERRIDES } from "../src/safe-search-overrides";
import { PIECES } from "../web/examples";

const ROUNDS = 5; // each query's time is its median over these

export function run(path: string) {
  const bytes = new Uint8Array(readFileSync(path));
  let started = performance.now();
  const index = HeadwordIndex.fromBytes(bytes);
  const completer = new Completer(index, SAFE_SEARCH_OVERRIDES);
  const filters = defaultFilters();
  completer.prepare(filters);
  const opening = performance.now() - started;

  const queries = [..."abcdefghijklmnopqrstuvwxyz", ...PIECES.map(([piece]) => piece)];
  const firstScreen: number[] = [];
  const counted: number[] = [];
  for (const query of queries) {
    const firsts: number[] = [];
    const alls: number[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      started = performance.now();
      const matches = completer.search(query, { filters });
      matches.rows(0, 50);
      firsts.push(performance.now() - started);
      while (!matches.complete) matches.count(1e9);
      alls.push(performance.now() - started);
    }
    firstScreen.push(median(firsts));
    counted.push(median(alls));
  }

  const ms = (n: number) => (n < 10 ? n.toFixed(1) : n.toFixed(0));
  console.log(`${index.size.toLocaleString("en")} words, ${queries.length} searches (every letter and suggestion), ${cpus()[0].model}`);
  console.log(`opening the word list: ${ms(opening)} ms`);
  console.log("                      median   95th   slowest");
  for (const [label, times] of [["first screen", firstScreen], ["all counted", counted]] as const) {
    const sorted = [...times].sort((a, b) => a - b);
    const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
    console.log(`${label.padEnd(20)}${ms(at(0.5)).padStart(7)} ms${ms(at(0.95)).padStart(5)} ms${ms(sorted.at(-1)!).padStart(6)} ms`);
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
