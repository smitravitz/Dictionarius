/** Identifies the rule below. Index files record the rule they were built
 *  with; change this whenever normalize() changes so stale indexes are refused. */
export const NORMALIZATION_ID = "nfd-strip-diacritic-lower-trim/v1";

/** Unicode-fold for matching: strip diacritics, lowercase, trim. Single source
 *  of truth shared by query-time (Dictionary) and index-time (SQLite adapter,
 *  scripts/build_fm_index.py). */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}
