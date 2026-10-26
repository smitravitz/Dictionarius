export interface Attribution {
  source: string;
  license: string;
}

export interface Sense {
  partOfSpeech: string;
  gloss: string;
}

export interface Entry {
  headword: string;
  senses: Sense[];
  attribution: Attribution;
}

export interface SearchHit {
  headword: string;
  score: number;
}

/**
 * The data-store boundary. Real implementations wrap SQLite FTS / a packed JSON
 * index / an HTTP endpoint. Tests inject a fixture. This is the ONLY seam we mock.
 *
 * getCandidates is a dumb provider: it returns a plausible superset of entries.
 * Correctness (normalization, matching, ranking) lives in Dictionary — the store
 * may pre-filter for performance in production, but never owns semantics.
 */
export interface DictionarySource {
  getByHeadword(word: string): Promise<Entry | null>;
  getCandidates(normalizedQuery: string): Promise<Entry[]>;
}
