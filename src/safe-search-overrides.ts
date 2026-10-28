import type { SafeSearchOverrides } from "./complete";

/**
 * Hand corrections to the index's safe-search list (docs/index-format.md,
 * "Safe search"), applied when the app loads, so a mistake is fixed without
 * rebuilding the index. Each build writes `headwords.safe-review.tsv`: every
 * word it hides, most common first, with why. Read it, then list here:
 *
 * - allow: everyday words hidden only for a rare meaning most readers would
 *   never think of;
 * - block: words the labels missed.
 *
 * Words match as typed in the search box (case and accents don't matter). One
 * entry per word: "boys" isn't covered by "boy".
 */
export const SAFE_SEARCH_OVERRIDES: SafeSearchOverrides = {
  allow: [],
  block: [],
};
