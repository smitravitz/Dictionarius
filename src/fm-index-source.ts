import type { DictionarySource, Entry } from "./source";
import { normalize } from "./normalize";
import { FmIndex, TERM, SEP } from "./fm-index";

/**
 * DictionarySource backed by an FM-index over normalized headwords. Gives true
 * mid-word (substring) matching that the prefix-only SQLite source cannot, while
 * satisfying the same DictionarySource contract.
 *
 * Layout: text = SEP w0 SEP w1 SEP ... SEP TERM. A parallel wordOf[] maps each
 * text position back to its entry; separators/terminator map to -1.
 */
export class FmIndexSource implements DictionarySource {
  private byHeadword = new Map<string, Entry>();
  private entries: Entry[] = [];
  private fm: FmIndex | null = null;
  private wordOf: Int32Array = new Int32Array(0);

  async ingest(entries: Entry[]): Promise<void> {
    this.entries = entries.slice();
    this.byHeadword = new Map();
    for (const e of entries) this.byHeadword.set(e.headword, e);

    const codes: number[] = [];
    const wordOf: number[] = [];
    entries.forEach((e, idx) => {
      codes.push(SEP);
      wordOf.push(-1);
      for (const ch of normalize(e.headword)) {
        codes.push(ch.codePointAt(0)! + 2); // shift so codes never collide with TERM/SEP
        wordOf.push(idx);
      }
    });
    codes.push(SEP);
    wordOf.push(-1);
    codes.push(TERM);
    wordOf.push(-1);

    this.fm = new FmIndex(Int32Array.from(codes));
    this.wordOf = Int32Array.from(wordOf);
  }

  async getByHeadword(word: string): Promise<Entry | null> {
    return this.byHeadword.get(word) ?? null;
  }

  async getCandidates(normalizedQuery: string): Promise<Entry[]> {
    const q = normalize(normalizedQuery);
    if (q === "" || this.fm === null) return [];

    const pattern = Int32Array.from([...q].map((ch) => ch.codePointAt(0)! + 2));
    const positions = this.fm.locate(pattern);

    const seen = new Set<number>();
    const out: Entry[] = [];
    for (const pos of positions) {
      const idx = this.wordOf[pos];
      if (idx >= 0 && !seen.has(idx)) {
        seen.add(idx);
        out.push(this.entries[idx]);
      }
    }
    return out;
  }
}
