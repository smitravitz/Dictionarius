import type { DictionarySource, Entry, SearchHit } from "./source";

/** Unicode-fold: strip diacritics, lowercase, trim. Behavior tested via public methods. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

const EXACT = 3;
const PREFIX = 2;
const SUBSTRING = 1;
const NO_MATCH = 0;

function scoreOf(headwordNorm: string, queryNorm: string): number {
  if (headwordNorm === queryNorm) return EXACT;
  if (headwordNorm.startsWith(queryNorm)) return PREFIX;
  if (headwordNorm.includes(queryNorm)) return SUBSTRING;
  return NO_MATCH;
}

/** Levenshtein edit distance. Used only for the "did you mean" fallback. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[a.length][b.length];
}

const FUZZY_MAX_DISTANCE = 2;

export class Dictionary {
  constructor(private readonly source: DictionarySource) {}

  async lookup(word: string): Promise<Entry | null> {
    return this.source.getByHeadword(word);
  }

  async search(query: string): Promise<SearchHit[]> {
    const q = normalize(query);
    if (q === "") return [];

    const candidates = await this.source.getCandidates(q);
    return candidates
      .map((e) => ({ headword: e.headword, score: scoreOf(normalize(e.headword), q) }))
      .filter((h) => h.score > NO_MATCH)
      .sort((a, b) => b.score - a.score || a.headword.localeCompare(b.headword));
  }

  async suggest(query: string): Promise<string[]> {
    const q = normalize(query);
    if (q === "") return [];

    const candidates = await this.source.getCandidates(q);

    const prefixMatches = candidates
      .filter((e) => normalize(e.headword).startsWith(q))
      .map((e) => e.headword)
      .sort((a, b) => a.localeCompare(b));

    if (prefixMatches.length > 0) return prefixMatches;

    // Did-you-mean fallback: nearest by edit distance within threshold.
    return candidates
      .map((e) => ({ headword: e.headword, dist: editDistance(normalize(e.headword), q) }))
      .filter((h) => h.dist <= FUZZY_MAX_DISTANCE)
      .sort((a, b) => a.dist - b.dist || a.headword.localeCompare(b.headword))
      .map((h) => h.headword);
  }
}
