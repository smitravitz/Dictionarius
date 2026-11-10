/**
 * The starter (src/starter.ts) for a word list's bytes: the start screen's suggestions
 * (web/examples.ts) with the default filters, worked out by the app's own search code.
 * tools/web-data.ts loads this through Vite, so the code it runs is the app's.
 */
import { HeadwordIndex } from "../src/headword-index";
import { Completer } from "../src/complete";
import { defaultFilters } from "../src/filters";
import { SAFE_SEARCH_OVERRIDES } from "../src/safe-search-overrides";
import { buildStarter, type DataFile, type Starter } from "../src/starter";
import { PIECES } from "../web/examples";

export function makeStarter(indexBytes: Uint8Array, files: Record<string, DataFile>): Starter {
  const index = HeadwordIndex.fromBytes(indexBytes);
  const completer = new Completer(index, SAFE_SEARCH_OVERRIDES);
  return buildStarter(index, completer, PIECES.map(([piece]) => piece), defaultFilters(), files);
}
