import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { HeadwordIndex } from "../src/headword-index";
import { DefinitionsFile, LAYERS, unpack, type Definition, type Layer } from "../src/definitions";

// The definitions (docs/definitions-format.md): every word's meanings by the
// index's word id, in compressed blocks, with examples, etymology and
// pronunciation each in a layer file beside them (ADR-0005). The builder's golden
// file holds what it wrote for some words (read back in Python, every layer
// present); the app must read the same.

const FIXTURE = "test/fixtures/headwords-sample";

interface Golden {
  keysHash: string;
  definitions?: { ids: { id: number; definitions: Definition[] | null }[] };
}

const hex = (bytes: Uint8Array | null) => (bytes ? Buffer.from(bytes).toString("hex") : null);

function describeAgainstGolden(name: string, base: string) {
  const present = [".bin", ".golden.json", ".definitions.bin"].every((ext) => existsSync(base + ext));
  describe.skipIf(!present)(`definitions vs golden: ${name}`, () => {
    if (!present) return; // collecting the suite mustn't read files that aren't there
    const index = HeadwordIndex.fromBytes(new Uint8Array(readFileSync(`${base}.bin`)));
    const golden = JSON.parse(readFileSync(`${base}.golden.json`, "utf8")) as Golden;
    const bytes = () => new Uint8Array(readFileSync(`${base}.definitions.bin`));
    const layer = (kind: Layer) => new Uint8Array(readFileSync(`${base}.${kind}.bin`));
    const allLayers = () => Object.fromEntries(LAYERS.map((kind) => [kind, layer(kind)]));

    it("ties the index to its key list", () => {
      expect(hex(index.keysHash())).toBe(golden.keysHash);
    });

    it("reads each word's definitions by id, as the builder wrote them; none for words without", async () => {
      const definitions = DefinitionsFile.fromBytes(bytes(), index, allLayers());
      expect(golden.definitions!.ids.length).toBeGreaterThan(5);
      for (const { id, definitions: expected } of golden.definitions!.ids) {
        expect(await definitions.of(id), index.key(id)).toEqual(expected);
      }
    });

    it("leaves out only a missing layer's content", async () => {
      // Without examples and etymology: the same words, meanings and pronunciations.
      const definitions = DefinitionsFile.fromBytes(bytes(), index, { pronunciation: layer("pronunciation") });
      for (const { id, definitions: expected } of golden.definitions!.ids) {
        const without = expected?.map(({ etymology: _, ...d }) => ({
          ...d,
          meanings: d.meanings.map(({ example: __, ...m }) => m),
        }));
        expect(await definitions.of(id), index.key(id)).toEqual(without ?? null);
      }
    });

    it("refuses a definitions file built for another word list", () => {
      const other = bytes();
      other[32] ^= 0xff; // the first byte of its key list's hash
      expect(() => DefinitionsFile.fromBytes(other, index)).toThrow(/another word list/);
    });

    it("refuses a layer built for another word list", () => {
      const other = layer("examples");
      other[32] ^= 0xff;
      expect(() => DefinitionsFile.fromBytes(bytes(), index, { examples: other })).toThrow(/another word list/);
    });

    it("refuses a layer given as another kind", () => {
      expect(() => DefinitionsFile.fromBytes(bytes(), index, { etymology: layer("examples") })).toThrow(/holds examples, not etymology/);
    });

    it("has a file for each layer the builder writes", () => {
      for (const kind of LAYERS) expect(existsSync(`${base}.${kind}.bin`), kind).toBe(true);
    });
  });
}

describeAgainstGolden("public-domain fixture", FIXTURE);
describeAgainstGolden("local build ($DICTIONARIUS_INDEX or dist/headwords)", process.env.DICTIONARIUS_INDEX ?? "dist/headwords");

describe("reading a block at a time (ADR-0005)", () => {
  // A file is read through a source that hands out byte ranges (a Blob's slices in the
  // app), so only what a word needs is ever in memory, never the whole file.
  const index = HeadwordIndex.fromBytes(new Uint8Array(readFileSync(`${FIXTURE}.bin`)));
  const golden = JSON.parse(readFileSync(`${FIXTURE}.golden.json`, "utf8")) as Golden;
  const counted = (bytes: Uint8Array) => {
    const reads: [number, number][] = [];
    return { reads, source: { size: bytes.byteLength, read: async (start: number, end: number) => (reads.push([start, end]), bytes.slice(start, end)) } };
  };
  const file = (name: string) => new Uint8Array(readFileSync(`${FIXTURE}.${name}.bin`));

  it("opens a file by its header, tables and block offsets alone", async () => {
    const core = file("definitions");
    const { reads, source } = counted(core);
    await DefinitionsFile.open(source, index);
    const read = reads.reduce((sum, [a, b]) => sum + b - a, 0);
    expect(read).toBeLessThan(core.byteLength); // not the blocks
  });

  it("reads one block of each file for a word, and gives the same definitions as reading it all", async () => {
    const sources: Record<string, ReturnType<typeof counted>> = { core: counted(file("definitions")) };
    for (const kind of LAYERS) sources[kind] = counted(file(kind));
    const layers = Object.fromEntries(LAYERS.map((k) => [k, sources[k].source]));
    const definitions = await DefinitionsFile.open(sources.core.source, index, layers);
    for (const s of Object.values(sources)) s.reads.length = 0; // count from here: one word
    const { id, definitions: expected } = golden.definitions!.ids.find((d) => d.definitions)!;
    expect(await definitions.of(id)).toEqual(expected);
    for (const [kind, s] of Object.entries(sources)) expect(s.reads.length, kind).toBe(1);
  });
});

// The release workflow runs this on the data it downloaded (DICTIONARIUS_RELEASE_DATA=release-data):
// an app must never ship with data its own code can't open, or with a layer left behind.
const release = process.env.DICTIONARIUS_RELEASE_DATA;
describe.skipIf(!release)("the release's data opens with this code", () => {
  it("opens the index, the definitions and every layer", async () => {
    const read = (name: string) => new Uint8Array(readFileSync(`${release}/${name}`));
    const index = HeadwordIndex.fromBytes(read("headwords.bin"));
    const layers = Object.fromEntries(LAYERS.map((kind) => [kind, read(`headwords.${kind}.bin`)]));
    const definitions = DefinitionsFile.fromBytes(read("headwords.definitions.bin"), index, layers);
    const id = index.exact("water");
    expect(id, "water is a word").not.toBeNull();
    expect((await definitions.of(id!))?.length).toBeGreaterThan(0);
  });
});

describe("DefinitionsFile rejects files it can't read", () => {
  const index = HeadwordIndex.fromBytes(new Uint8Array(readFileSync(`${FIXTURE}.bin`)));
  const bytes = () => new Uint8Array(readFileSync(`${FIXTURE}.definitions.bin`));

  it("rejects a file that isn't a definitions file", () => {
    const bad = bytes();
    bad[0] = 0x58;
    expect(() => DefinitionsFile.fromBytes(bad, index)).toThrow(/not a definitions file/);
  });

  it("rejects a truncated file", () => {
    expect(() => DefinitionsFile.fromBytes(bytes().slice(0, 100), index)).toThrow(/truncated/);
  });

  it("answers null for an id outside the index", async () => {
    const definitions = DefinitionsFile.fromBytes(bytes(), index);
    expect(await definitions.of(index.size)).toBeNull();
    expect(await definitions.of(-1)).toBeNull();
  });
});

describe("unpack", () => {
  it("puts a link's word back into its template literally, even with $ in it", () => {
    const tables = { pos: ["noun"], templates: ["plural of \u0000"] };
    expect(unpack("a$&bs", { core: '[[0],[[0,0,[[0,[],["A$&B"]]]]]]' }, tables)).toEqual([
      { form: "a$&bs", pos: "noun", meanings: [{ gloss: "plural of A$&B", of: ["A$&B"] }] },
    ]);
  });

  it("gives each meaning its example, in reading order across entries", () => {
    const tables = { pos: ["verb", "noun"], templates: [] };
    const lines = { core: '[[0],[[0,0,[["To wobble."],["To sway."]]],[0,1,[["A wobble."]]]]]', examples: '["It zorbled.","","A big zorble."]' };
    expect(unpack("zorble", lines, tables)).toEqual([
      { form: "zorble", pos: "verb", meanings: [{ gloss: "To wobble.", example: "It zorbled." }, { gloss: "To sway." }] },
      { form: "zorble", pos: "noun", meanings: [{ gloss: "A wobble.", example: "A big zorble." }] },
    ]);
  });
});
