import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { HeadwordIndex } from "../src/headword-index";
import { DefinitionsFile, unpack, type Definition } from "../src/definitions";

// The definitions file (docs/definitions-format.md): every word's definitions,
// by the index's word id, in compressed blocks. The builder's golden file holds
// what it wrote for some words (read back in Python); the app must read the same.

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

    it("ties the index to its key list", () => {
      expect(hex(index.keysHash())).toBe(golden.keysHash);
    });

    it("reads each word's definitions by id, as the builder wrote them; none for words without", async () => {
      const definitions = DefinitionsFile.fromBytes(bytes(), index);
      expect(golden.definitions!.ids.length).toBeGreaterThan(5);
      for (const { id, definitions: expected } of golden.definitions!.ids) {
        expect(await definitions.of(id), index.key(id)).toEqual(expected);
      }
    });

    it("refuses a definitions file built for another word list", () => {
      const other = bytes();
      other[32] ^= 0xff; // the first byte of its key list's hash
      expect(() => DefinitionsFile.fromBytes(other, index)).toThrow(/another word list/);
    });
  });
}

describeAgainstGolden("public-domain fixture", FIXTURE);
describeAgainstGolden("local build ($DICTIONARIUS_INDEX or dist/headwords)", process.env.DICTIONARIUS_INDEX ?? "dist/headwords");

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
    expect(unpack("a$&bs", '[[0],[[0,0,[[0,[],["A$&B"]]]]]]', tables)).toEqual([
      { form: "a$&bs", pos: "noun", meanings: [{ gloss: "plural of A$&B", of: ["A$&B"] }] },
    ]);
  });
});
