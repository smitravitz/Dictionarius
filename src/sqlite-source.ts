import type { DatabaseSync } from "node:sqlite";
import type { DictionarySource, Entry } from "./source";
import { normalize } from "./normalize";

/**
 * SQLite-backed DictionarySource. Stores each entry as JSON plus a normalized
 * headword column for portable prefix matching (LIKE 'q%') across web / iOS /
 * Android / F-Droid SQLite builds. Swap FTS5 in later for full-definition search.
 *
 * The db handle is injected: pass ':memory:' in tests, a file/asset DB in the app.
 */
export class SqliteDictionarySource implements DictionarySource {
  constructor(private readonly db: DatabaseSync) {}

  async init(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        headword       TEXT PRIMARY KEY,
        headword_norm  TEXT NOT NULL,
        json           TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_entries_norm ON entries (headword_norm);
    `);
  }

  async ingest(entries: Entry[]): Promise<void> {
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO entries (headword, headword_norm, json) VALUES (?, ?, ?)",
    );
    for (const e of entries) {
      stmt.run(e.headword, normalize(e.headword), JSON.stringify(e));
    }
  }

  async getByHeadword(word: string): Promise<Entry | null> {
    const row = this.db
      .prepare("SELECT json FROM entries WHERE headword = ?")
      .get(word) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as Entry) : null;
  }

  async getCandidates(normalizedQuery: string): Promise<Entry[]> {
    const q = normalize(normalizedQuery);
    if (q === "") return [];
    const rows = this.db
      .prepare("SELECT json FROM entries WHERE headword_norm LIKE ? ESCAPE '\\'")
      .all(`${escapeLike(q)}%`) as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as Entry);
  }
}

/** Escape LIKE wildcards so a query like "50%" matches literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
