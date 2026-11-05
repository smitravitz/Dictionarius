/**
 * Reads the definitions written by scripts/build_fm_index.py (layout:
 * docs/definitions-format.md): every word's meanings by the headword index's word
 * id, in blocks compressed separately (brotli, ADR-0004) so showing one word
 * unpacks only its block; and beside them, one layer file each for examples,
 * etymology and pronunciation (ADR-0005), any of which an app may leave out.
 * Every file names the index's key list (KEYHASH), so one built for another word
 * list is refused instead of showing every word the wrong meanings.
 *
 * unpack() is the twin of scripts/definitions.py's: the builder's golden file
 * checks that both read the same definitions.
 */
import decompress from "brotli/decompress.js";
import type { HeadwordIndex } from "./headword-index";

/** What a word's page shows beyond its meanings, each in a file of its own beside
 *  the core (headwords.examples.bin, …). The builder writes the same list (LAYERS
 *  in scripts/definitions.py); the fixture's files keep the two in step. */
export const LAYERS = ["examples", "etymology", "pronunciation"] as const;
export type Layer = (typeof LAYERS)[number];

/** Where a layer file is, beside its core (`….definitions.bin`): `….examples.bin`, … */
export function layerUrl(coreUrl: string, kind: Layer): string {
  return coreUrl.replace(/\.definitions\.bin$/, `.${kind}.bin`);
}

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
  /** one short example of the meaning in use */
  example?: string;
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
const VERSION = 3;
const CODEC_BROTLI = 2;
const HEADER_SIZE = 64;
const HOLE = "\u0000";
const utf8 = new TextDecoder("utf-8", { fatal: true });
/** Unpacked blocks kept per file, most recent first: a peek and its entry page (ADR-0005's
 *  gate: a file in memory is its header and two blocks, never the whole of it). */
const CACHED_BLOCKS = 2;

/** Where a file's bytes come from, a range at a time. Today: bytes in memory. A source
 *  that reads ranges from storage (so a file is never all in memory) plugs in here;
 *  a Blob doesn't do it (measured: the browser keeps the Blob in memory instead,
 *  and word pages took twice as long; ADR-0005). */
export interface ByteSource {
  readonly size: number;
  read(start: number, end: number): Promise<Uint8Array>;
}

/** Bytes already in memory, as a source. */
export function bytesSource(bytes: Uint8Array): ByteSource {
  return { size: bytes.byteLength, read: async (start, end) => bytes.subarray(start, end) };
}

/**
 * One file of the container (ADR-0005): a header tying it to an index, a JSON
 * table saying what kind it is and what its lines share, and blocks of lines, one
 * line per word id, compressed separately. Read through a ByteSource, a block at a time.
 */
export class LayerFile {
  private readonly cache = new Map<number, Promise<string[]>>();

  private constructor(
    private readonly source: ByteSource,
    readonly perBlock: number,
    readonly tables: { kind: string } & Record<string, unknown>,
    private readonly offsets: Uint32Array,
  ) {}

  /** Open a layer file for `index`, reading only its header, tables and block offsets.
   *  Throws if it isn't one, or belongs to another word list. */
  static async open(source: ByteSource, index: HeadwordIndex): Promise<LayerFile> {
    if (source.size < HEADER_SIZE) throw new Error("not a definitions file");
    const header = await source.read(0, HEADER_SIZE);
    const head = parseHeader(header, source.size, index);
    return LayerFile.fromHead(source, head, await source.read(HEADER_SIZE, head.tableEnd));
  }

  /** open() for bytes already in memory (tests, tools). */
  static fromBytes(bytes: Uint8Array, index: HeadwordIndex): LayerFile {
    const head = parseHeader(bytes.subarray(0, HEADER_SIZE), bytes.byteLength, index);
    return LayerFile.fromHead(bytesSource(bytes), head, bytes.subarray(HEADER_SIZE, head.tableEnd));
  }

  private static fromHead(source: ByteSource, head: Header, rest: Uint8Array): LayerFile {
    const { perBlock, numBlocks, tablesLength } = head;
    const tables = JSON.parse(utf8.decode(rest.subarray(0, tablesLength))) as LayerFile["tables"];
    const offsets = new Uint32Array(numBlocks + 1);
    const table = new DataView(rest.buffer, rest.byteOffset + tablesLength, 4 * (numBlocks + 1));
    for (let b = 0; b <= numBlocks; b++) offsets[b] = table.getUint32(4 * b, true);
    if (offsets[numBlocks] > source.size) throw new Error("corrupt or truncated definitions file: blocks");
    return new LayerFile(source, perBlock, tables, offsets);
  }

  /** What this file holds: "core", or one of LAYERS. */
  get kind(): string {
    return this.tables.kind;
  }

  /** Word `id`'s line ("" when it has none here). */
  async line(id: number): Promise<string> {
    const lines = await this.block(Math.floor(id / this.perBlock));
    return lines[id % this.perBlock] ?? "";
  }

  /** One block's lines, read and unpacked once, kept while recently used. */
  private block(b: number): Promise<string[]> {
    let lines = this.cache.get(b);
    if (lines) {
      this.cache.delete(b); // move to the front
    } else {
      lines = this.source.read(this.offsets[b], this.offsets[b + 1]).then((packed) => utf8.decode(decompress(packed)).split("\n"));
      if (this.cache.size >= CACHED_BLOCKS) this.cache.delete(this.cache.keys().next().value!);
    }
    this.cache.set(b, lines);
    return lines;
  }
}

interface Header {
  perBlock: number;
  numBlocks: number;
  tablesLength: number;
  /** where the block offsets end: everything before it is the file's head */
  tableEnd: number;
}

/** A file's first 64 bytes, checked against its size and the index it's for. */
function parseHeader(header: Uint8Array, size: number, index: HeadwordIndex): Header {
  if (header.byteLength < HEADER_SIZE || ascii(header, 0, 8) !== MAGIC) {
    throw new Error("not a definitions file");
  }
  const view = new DataView(header.buffer, header.byteOffset, HEADER_SIZE);
  const u32 = (at: number) => view.getUint32(at, true);
  if (u32(8) !== VERSION || u32(12) !== CODEC_BROTLI) {
    throw new Error(`unsupported definitions file (version ${u32(8)}, codec ${u32(12)})`);
  }
  const [numWords, perBlock, numBlocks, tablesLength] = [u32(16), u32(20), u32(24), u32(28)];
  const keysHash = header.subarray(32, 64);
  const expected = index.keysHash();
  if (numWords !== index.size || !expected || !expected.every((b, i) => b === keysHash[i])) {
    throw new Error("definitions file belongs to another word list than this index");
  }
  const tableEnd = HEADER_SIZE + tablesLength + 4 * (numBlocks + 1);
  if (tableEnd > size || perBlock === 0 || numBlocks !== Math.ceil(numWords / perBlock)) {
    throw new Error("corrupt or truncated definitions file: tables");
  }
  return { perBlock, numBlocks, tablesLength, tableEnd };
}

/** A word's lines, one per file: the core's, and each present layer's. */
export type Lines = { core: string } & Partial<Record<Layer, string>>;

export class DefinitionsFile {
  private constructor(
    private readonly index: HeadwordIndex,
    private readonly core: LayerFile,
    private readonly layers: Partial<Record<Layer, LayerFile>>,
  ) {}

  /** Open the definitions for `index`: the core, and whichever layers there are, each
   *  read through its source a block at a time. Throws if one isn't a definitions file,
   *  belongs to another word list, or is given as a kind it isn't. */
  static async open(core: ByteSource, index: HeadwordIndex, layers: Partial<Record<Layer, ByteSource>> = {}): Promise<DefinitionsFile> {
    const coreFile = await LayerFile.open(core, index);
    const opened: Partial<Record<Layer, LayerFile>> = {};
    for (const kind of LAYERS) {
      const source = layers[kind];
      if (source) opened[kind] = await LayerFile.open(source, index);
    }
    return DefinitionsFile.checked(index, coreFile, opened);
  }

  /** open() for bytes already in memory (tests, tools). */
  static fromBytes(core: Uint8Array, index: HeadwordIndex, layers: Partial<Record<Layer, Uint8Array>> = {}): DefinitionsFile {
    const opened: Partial<Record<Layer, LayerFile>> = {};
    for (const kind of LAYERS) {
      const bytes = layers[kind];
      if (bytes) opened[kind] = LayerFile.fromBytes(bytes, index);
    }
    return DefinitionsFile.checked(index, LayerFile.fromBytes(core, index), opened);
  }

  private static checked(index: HeadwordIndex, core: LayerFile, layers: Partial<Record<Layer, LayerFile>>): DefinitionsFile {
    expectKind(core, "core");
    for (const kind of LAYERS) {
      const file = layers[kind];
      if (!file) continue;
      expectKind(file, kind);
      if (file.perBlock !== core.perBlock) throw new Error(`${kind} isn't blocked like its core`);
    }
    return new DefinitionsFile(index, core, layers);
  }

  /** A word's definitions, most common written form first; null when it has none. */
  async of(id: number): Promise<Definition[] | null> {
    if (!Number.isInteger(id) || id < 0 || id >= this.index.size) return null;
    const core = await this.core.line(id);
    if (!core) return null;
    const lines: Lines = { core };
    for (const kind of LAYERS) {
      const file = this.layers[kind];
      if (file) lines[kind] = await file.line(id);
    }
    return unpack(this.index.key(id), lines, this.core.tables as unknown as PackingTables);
  }
}

function expectKind(file: LayerFile, kind: string): LayerFile {
  if (file.kind !== kind) throw new Error(`that file holds ${file.kind}, not ${kind}`);
  return file;
}

type PackedMeaning = [
  gloss: string | number,
  labels?: string[],
  of?: string[],
  explicit?: 0 | 1,
  links?: (string | [string, string])[],
];
type PackedEntry = [form: number, pos: number | string | null, meanings: PackedMeaning[], etymology?: number, sound?: number];
type PackedCore = [forms: (0 | string)[], entries: PackedEntry[]];

/** One word's lines back to what the builder collected (docs/definitions-format.md).
 *  `key` is the word's search key: forms equal to it are stored as 0. A layer left
 *  out leaves out only its content. */
export function unpack(key: string, lines: Lines, tables: PackingTables): Definition[] {
  const [forms, entries] = JSON.parse(lines.core) as PackedCore;
  const layer = <T>(kind: Layer): T[] => (lines[kind] ? (JSON.parse(lines[kind]) as T[]) : []);
  const examples = layer<string>("examples");
  const etymologies = layer<string>("etymology");
  const sounds = layer<string[]>("pronunciation");
  let n = 0; // meanings so far: examples are one per meaning, in reading order
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
        const example = examples[n++];
        if (example) m.example = example;
        return m;
      }),
    };
    if (etymology && etymology <= etymologies.length) d.etymology = etymologies[etymology - 1];
    if (sound && sound <= sounds.length) d.ipa = sounds[sound - 1];
    return d;
  });
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
