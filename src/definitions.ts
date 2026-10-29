/**
 * Reads the definitions file written by scripts/build_fm_index.py (layout:
 * docs/definitions-format.md): every word's definitions, by the headword
 * index's word id, in blocks compressed separately (brotli, ADR-0004) so
 * showing one word unpacks only its block. The file names the index's key
 * list (KEYHASH), so a definitions file built for another word list is
 * refused instead of showing every word the wrong meanings.
 *
 * unpack() is the twin of scripts/definitions.py's: the builder's golden file
 * checks that both read the same definitions.
 */
import decompress from "brotli/decompress.js";
import type { HeadwordIndex } from "./headword-index";

/** One meaning of a word. */
export interface Meaning {
  gloss: string;
  /** "archaic", "slang", a qualifier like "of jelly" */
  labels?: string[];
  /** the words a plural or spelling is of ("plural of zorble") */
  of?: string[];
  /** vulgar, offensive or a slur: safe search hides it */
  explicit?: boolean;
  /** Wiktionary's links inside the gloss: [text] links to the word it spells,
   *  [text, word] to another ("running" → "run") */
  links?: ([string] | [string, string])[];
}

/** One entry of one written form: its word class and meanings. */
export interface Definition {
  form: string;
  /** Wiktionary's part of speech: "noun", "verb", "adj", "name", … */
  pos: string | null;
  meanings: Meaning[];
  /** where the word comes from */
  etymology?: string;
  /** pronunciations, IPA */
  ipa?: string[];
}

/** What packing shares across all words (the file's tables). */
export interface PackingTables {
  /** word classes, by number */
  pos: string[];
  /** link glosses with their word taken out: "plural of \u0000" */
  templates: string[];
}

const MAGIC = "DICTDEF1";
const VERSION = 2;
const CODEC_BROTLI = 2;
const HEADER_SIZE = 64;
const HOLE = "\u0000";
const utf8 = new TextDecoder("utf-8", { fatal: true });
/** Unpacked blocks kept, most recent first: a peek and its entry page, and a little more. */
const CACHED_BLOCKS = 8;

export class DefinitionsFile {
  private readonly cache = new Map<number, Promise<string[]>>();

  private constructor(
    private readonly bytes: Uint8Array,
    private readonly index: HeadwordIndex,
    private readonly perBlock: number,
    private readonly tables: PackingTables,
    private readonly offsets: Uint32Array,
  ) {}

  /** Open a definitions file for `index`; throws if it isn't one, or belongs to another word list. */
  static fromBytes(bytes: Uint8Array, index: HeadwordIndex): DefinitionsFile {
    if (bytes.byteLength < HEADER_SIZE || ascii(bytes, 0, 8) !== MAGIC) {
      throw new Error("not a definitions file");
    }
    const header = new DataView(bytes.buffer, bytes.byteOffset, HEADER_SIZE);
    const u32 = (at: number) => header.getUint32(at, true);
    if (u32(8) !== VERSION || u32(12) !== CODEC_BROTLI) {
      throw new Error(`unsupported definitions file (version ${u32(8)}, codec ${u32(12)})`);
    }
    const [numWords, perBlock, numBlocks, tablesLength] = [u32(16), u32(20), u32(24), u32(28)];
    const keysHash = bytes.subarray(32, 64);
    const expected = index.keysHash();
    if (numWords !== index.size || !expected || !expected.every((b, i) => b === keysHash[i])) {
      throw new Error("definitions file belongs to another word list than this index");
    }
    const tableAt = HEADER_SIZE + tablesLength;
    const tableEnd = tableAt + 4 * (numBlocks + 1);
    if (tableEnd > bytes.byteLength || perBlock === 0 || numBlocks !== Math.ceil(numWords / perBlock)) {
      throw new Error("corrupt or truncated definitions file: tables");
    }
    const tables = JSON.parse(utf8.decode(bytes.subarray(HEADER_SIZE, tableAt))) as PackingTables;
    const offsets = new Uint32Array(numBlocks + 1);
    const table = new DataView(bytes.buffer, bytes.byteOffset + tableAt, 4 * (numBlocks + 1));
    for (let b = 0; b <= numBlocks; b++) offsets[b] = table.getUint32(4 * b, true);
    if (offsets[numBlocks] > bytes.byteLength) throw new Error("corrupt or truncated definitions file: blocks");
    return new DefinitionsFile(bytes, index, perBlock, tables, offsets);
  }

  /** A word's definitions, most common written form first; null when it has none. */
  async of(id: number): Promise<Definition[] | null> {
    if (!Number.isInteger(id) || id < 0 || id >= this.index.size) return null;
    const lines = await this.block(Math.floor(id / this.perBlock));
    const line = lines[id % this.perBlock];
    return line ? unpack(this.index.key(id), line, this.tables) : null;
  }

  /** One block's lines, unpacked once and kept while recently used. */
  private block(b: number): Promise<string[]> {
    let lines = this.cache.get(b);
    if (lines) {
      this.cache.delete(b); // move to the front
    } else {
      const packed = this.bytes.subarray(this.offsets[b], this.offsets[b + 1]);
      lines = Promise.resolve().then(() => utf8.decode(decompress(packed)).split("\n"));
      if (this.cache.size >= CACHED_BLOCKS) this.cache.delete(this.cache.keys().next().value!);
    }
    this.cache.set(b, lines);
    return lines;
  }
}

type PackedMeaning = [gloss: string | number, labels?: string[], of?: string[], explicit?: 0 | 1, links?: (string | [string, string])[]];
type PackedEntry = [form: number, pos: number | string | null, meanings: PackedMeaning[], etymology?: number, sound?: number];
type Packed = [forms: (0 | string)[], entries: PackedEntry[], etymologies?: string[], sounds?: string[][]];

/** One word's packed definitions back to what the builder collected
 *  (docs/definitions-format.md). `key` is the word's search key: forms equal to it are stored as 0. */
export function unpack(key: string, line: string, tables: PackingTables): Definition[] {
  const [forms, entries, etymologies = [], sounds = []] = JSON.parse(line) as Packed;
  return entries.map(([form, pos, meanings, etymology = 0, sound = 0]) => {
    const written = forms[form];
    const d: Definition = {
      form: written === 0 ? key : written,
      pos: typeof pos === "number" ? tables.pos[pos] : pos,
      meanings: meanings.map(([gloss, labels = [], of = [], explicit = 0, links = []]) => {
        const m: Meaning = { gloss: typeof gloss === "number" ? tables.templates[gloss].replace(HOLE, () => of[0]) /* a function: "$" in a word stays literal, as in Python */ : gloss };
        if (labels.length) m.labels = labels;
        if (of.length) m.of = of;
        if (explicit) m.explicit = true;
        if (links.length) m.links = links.map((link) => (typeof link === "string" ? [link] : link));
        return m;
      }),
    };
    if (etymology) d.etymology = etymologies[etymology - 1];
    if (sound) d.ipa = sounds[sound - 1];
    return d;
  });
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
