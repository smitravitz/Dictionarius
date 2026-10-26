/** Unicode-fold for matching: strip diacritics, lowercase, trim. Single source
 *  of truth shared by query-time (Dictionary) and index-time (SQLite adapter). */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}
