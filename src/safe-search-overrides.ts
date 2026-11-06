import list from "../data/safe-search.list?raw";
import type { SafeSearchOverrides } from "./filters";
import { parseSafeSearchList } from "./safe-search-list";

// Safe search's hand-picked list, bundled into the app (src/safe-search-list.ts reads
// it; this module only loads it, which takes Vite's ?raw import).
export { decodeEntry, encodeEntry, parseSafeSearchList } from "./safe-search-list";

export const SAFE_SEARCH_OVERRIDES: SafeSearchOverrides = parseSafeSearchList(list);
