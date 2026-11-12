import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { HeadwordIndex } from "../src/headword-index";
import { DefinitionsFile, LAYERS, Unreachable, bytesSource, openSource, rangeSource, unpack, type ByteSource, type Definition, type Layer, type WordKeys } from "../src/definitions";
import { Completer } from "../src/complete";
import { defaultFilters } from "../src/filters";
import { SAFE_SEARCH_OVERRIDES } from "../src/safe-search-overrides";
import { buildStarter, starterKeys } from "../src/starter";
import { PIECES } from "../web/examples";

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

describe("reading in place, with Range requests (ADR-0005)", () => {
  // In the Android app, each block is fetched by itself from the file in the APK, so a
  // file is never all in memory. Only a server that sends exactly the range asked for
  // counts: Capacitor's own says 206 but sends the whole file.
  const index = HeadwordIndex.fromBytes(new Uint8Array(readFileSync(`${FIXTURE}.bin`)));
  const golden = JSON.parse(readFileSync(`${FIXTURE}.golden.json`, "utf8")) as Golden;
  const core = new Uint8Array(readFileSync(`${FIXTURE}.definitions.bin`));
  type Server = (range: [number, number]) => { status: number; body: Uint8Array; contentRange?: string };
  const fetcher = (server: Server) => {
    const asked: string[] = [];
    const fetchFn = async (_url: string, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("Range") ?? "";
      asked.push(range);
      const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
      const { status, body, contentRange } = server([Number(a), Number(b) + 1]);
      return new Response(body as BodyInit, { status, headers: contentRange ? { "Content-Range": contentRange } : {} });
    };
    return { asked, fetchFn: fetchFn as typeof fetch };
  };
  const honest: Server = ([a, b]) => ({ status: 206, body: core.slice(a, b), contentRange: `bytes ${a}-${b - 1}/${core.byteLength}` });

  it("reads a word's definitions a block at a time from a server that sends ranges", async () => {
    const { asked, fetchFn } = fetcher(honest);
    const source = await rangeSource("/d.definitions.bin", fetchFn);
    expect(source?.size).toBe(core.byteLength);
    const definitions = await DefinitionsFile.open(source!, index);
    asked.length = 0;
    const { id, definitions: expected } = golden.definitions!.ids.find((d) => d.definitions)!;
    const meanings = (await definitions.of(id))?.map((d) => d.meanings.map((m) => m.gloss));
    expect(meanings).toEqual(expected!.map((d) => d.meanings.map((m) => m.gloss)));
    expect(asked).toHaveLength(1); // one block
  });

  it("reads in place over real HTTP, from a server whose ranges this project didn't write (Vite's)", async () => {
    const { preview } = await import("vite");
    const server = await preview({
      configFile: false,
      logLevel: "silent",
      build: { outDir: "test/fixtures" },
      preview: { port: 0, host: "127.0.0.1" },
    });
    try {
      const { port } = server.httpServer.address() as { port: number };
      const url = (name: string) => `http://127.0.0.1:${port}/headwords-sample.${name}.bin`;
      const layers = Object.fromEntries(await Promise.all(LAYERS.map(async (k) => [k, (await rangeSource(url(k)))!])));
      const definitions = await DefinitionsFile.open((await rangeSource(url("definitions")))!, index, layers);
      for (const { id, definitions: expected } of golden.definitions!.ids) {
        expect(await definitions.of(id), index.key(id)).toEqual(expected ?? null);
      }
    } finally {
      await server.close();
    }
  });

  it("reads the whole file instead if ranges stop working after it opened", async () => {
    // Whatever goes wrong on the way (the app's server losing its file, say), a word's
    // page costs memory, never its definitions.
    let served = 0;
    const flaky: Server = (range) => (++served <= 2 ? honest(range) : { status: 206, body: core, contentRange: honest(range).contentRange });
    const asked: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("Range");
      asked.push(range ?? "whole");
      if (!range) return new Response(core as BodyInit, { status: 200 });
      const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
      const { status, body, contentRange } = flaky([Number(a), Number(b) + 1]);
      return new Response(body as BodyInit, { status, headers: contentRange ? { "Content-Range": contentRange } : {} });
    }) as typeof fetch;
    const definitions = await DefinitionsFile.open((await rangeSource("/d.definitions.bin", fetchFn))!, index);
    const { id, definitions: expected } = golden.definitions!.ids.find((d) => d.definitions)!;
    const meanings = (await definitions.of(id))?.map((d) => d.meanings.map((m) => m.gloss));
    expect(meanings).toEqual(expected!.map((d) => d.meanings.map((m) => m.gloss)));
    expect(asked.filter((a) => a === "whole")).toHaveLength(1); // fetched whole once, then read from memory
  });

  it("won't read in place from a server that says 206 but sends the whole file", async () => {
    const { fetchFn } = fetcher(([a, b]) => ({ status: 206, body: core, contentRange: `bytes ${a}-${b - 1}/${core.byteLength}` }));
    expect(await rangeSource("/d.definitions.bin", fetchFn)).toBeNull();
  });

  it("won't read in place from a server that ignores ranges", async () => {
    const { fetchFn } = fetcher(() => ({ status: 200, body: core }));
    expect(await rangeSource("/d.definitions.bin", fetchFn)).toBeNull();
  });

  // A phone's network: a request lost on the way, or one that never answers. Neither may
  // leave a word's page waiting for ever, nor turn into downloading the whole file.
  const header = (range: string) => range.startsWith("bytes=0-");
  const meaningsOf = async (definitions: DefinitionsFile, id: number) => (await definitions.of(id))?.map((d) => d.meanings.map((m) => m.gloss));
  const { id: someId, definitions: someExpected } = golden.definitions!.ids.find((d) => d.definitions)!;
  const someMeanings = someExpected!.map((d) => d.meanings.map((m) => m.gloss));

  it("asks again for a block lost on the way, and never downloads the whole file for it", async () => {
    const { asked, fetchFn: honestFetch } = fetcher(honest);
    let lose = 1;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("Range");
      if (!range) asked.push("whole");
      if (range && !header(range) && lose-- > 0) throw new TypeError("Failed to fetch");
      return honestFetch(url, init);
    }) as typeof fetch;
    const definitions = await DefinitionsFile.open((await rangeSource("/d.definitions.bin", fetchFn, { retryAfterMs: 0 }))!, index);
    expect(await meaningsOf(definitions, someId)).toEqual(someMeanings);
    expect(asked).not.toContain("whole");
  });

  it("gives up on a block that never comes, at its deadline, and reads it next time it's asked", async () => {
    const { asked, fetchFn: honestFetch } = fetcher(honest);
    let stalled = false;
    const fetchFn = ((url: string, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("Range");
      if (!range) asked.push("whole");
      if (stalled && range) {
        // No signal: no answer, until the reader stops waiting.
        return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
      }
      return honestFetch(url, init);
    }) as typeof fetch;
    const source = await rangeSource("/d.definitions.bin", fetchFn, { timeoutMs: 30, retryAfterMs: 0 });
    const definitions = await DefinitionsFile.open(source!, index);
    stalled = true; // opened; then the signal goes
    await expect(definitions.of(someId)).rejects.toBeInstanceOf(Unreachable);
    stalled = false; // the signal's back: the same word, asked again, isn't stuck on the failure
    expect(await meaningsOf(definitions, someId)).toEqual(someMeanings);
    expect(asked).not.toContain("whole");
  });

  it("tells a network it can't reach from a file that isn't there", async () => {
    const unreachable = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expect(openSource("/d.definitions.bin", { inPlace: true, fetchFn: unreachable, retryAfterMs: 0 })).rejects.toBeInstanceOf(Unreachable);
    const missing = (async () => new Response("Not Found", { status: 404 })) as typeof fetch;
    expect(await openSource("/d.definitions.bin", { inPlace: true, fetchFn: missing })).toBeNull();
  });
});

describe("reading in place: every word, whatever the server does", () => {
  // Every word the fixture has (17,082 ids, not only the golden ones), opened the way the
  // app opens its files (openSource), must read exactly as from the files held whole.
  const index = HeadwordIndex.fromBytes(new Uint8Array(readFileSync(`${FIXTURE}.bin`)));
  const names = ["definitions", ...LAYERS] as const;
  const files = Object.fromEntries(names.map((n) => [n, new Uint8Array(readFileSync(`${FIXTURE}.${n}.bin`))]));
  const whole = DefinitionsFile.fromBytes(files.definitions, index, Object.fromEntries(LAYERS.map((k) => [k, files[k]])));
  const ids = Array.from({ length: index.size }, (_, i) => i);
  const nameOf = (url: string) => /\.(\w+)\.bin$/.exec(url)![1];

  /** A server for the five files; `answer` decides each request (n counts requests per file). */
  type Answer = (file: Uint8Array, range: [number, number] | null, n: number) => Response | Promise<Response>;
  const serve = (answer: Answer) => {
    const count = new Map<string, number>();
    return (async (url: string, init?: RequestInit) => {
      const name = nameOf(url);
      const n = (count.get(name) ?? 0) + 1;
      count.set(name, n);
      const header = new Headers(init?.headers).get("Range");
      const m = header ? /^bytes=(\d+)-(\d+)$/.exec(header)! : null;
      return answer(files[name], m ? [Number(m[1]), Number(m[2]) + 1] : null, n);
    }) as typeof fetch;
  };
  const partial = (file: Uint8Array, [a, b]: [number, number]) =>
    new Response(file.slice(a, b) as BodyInit, { status: 206, headers: { "Content-Range": `bytes ${a}-${b - 1}/${file.byteLength}` } });
  const full = (file: Uint8Array) => new Response(file as BodyInit, { status: 200 });
  const honest: Answer = (file, range) => (range ? partial(file, range) : full(file));

  const open = async (fetchFn: typeof fetch) => {
    const url = (n: string) => `/headwords-sample.${n}.bin`;
    const core = await openSource(url("definitions"), { inPlace: true, fetchFn, retryAfterMs: 0 });
    const layers: Partial<Record<Layer, ByteSource>> = {};
    for (const k of LAYERS) {
      const source = await openSource(url(k), { inPlace: true, fetchFn, retryAfterMs: 0 });
      if (source) layers[k] = source;
    }
    return DefinitionsFile.open(core!, index, layers);
  };
  const sameAsWhole = async (fetchFn: typeof fetch, expected = (id: number) => whole.of(id)) => {
    const read = await open(fetchFn);
    for (const id of ids) expect(await read.of(id), index.key(id)).toEqual(await expected(id));
  };

  // Opening on a slow network: every round trip before the first word shows is a wait.
  describe("opening, on a slow network", () => {
    const url = (n: string) => `/headwords-sample.${n}.bin`;
    const sourcesFrom = (fetchFn: typeof fetch) => Promise.all(names.map((n) => openSource(url(n), { inPlace: true, fetchFn })));
    const asLayers = (sources: (ByteSource | null)[]) => Object.fromEntries(LAYERS.map((k, i) => [k, sources[i + 1]!]));

    it("opens every file at the same time, each in two requests: its first bytes, then its tables", async () => {
      const asked: string[] = [];
      const tablesHeld: (() => void)[] = [];
      const fetchFn = (async (at: string, init?: RequestInit) => {
        const name = nameOf(at);
        const range = new Headers(init?.headers).get("Range")!;
        asked.push(name);
        const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(range)!.map(Number);
        if (a === 64) {
          // Each file's tables are answered only once every file has asked for its own:
          // files opened one after another would never get there.
          await new Promise<void>((resolve) => {
            tablesHeld.push(resolve);
            if (tablesHeld.length === names.length) tablesHeld.forEach((answer) => answer());
          });
        }
        return partial(files[name], [a, b + 1]);
      }) as typeof fetch;
      const sources = await sourcesFrom(fetchFn);
      const opening = DefinitionsFile.openFitting(sources[0]!, index, asLayers(sources));
      const definitions = await Promise.race([opening, new Promise<never>((_, no) => setTimeout(() => no(new Error("the files were opened one after another")), 2000))]);
      for (const name of names) expect(asked.filter((n) => n === name), name).toHaveLength(2);
      for (const id of ids.slice(0, 50)) expect(await definitions.of(id), index.key(id)).toEqual(await whole.of(id));
    });

    it("leaves out a layer that isn't the kind it's given as, and opens the rest", async () => {
      const sources = await sourcesFrom(serve(honest));
      const layers = { ...asLayers(sources), examples: sources[1 + LAYERS.indexOf("etymology")]! }; // etymology, posing as examples
      const leftOut: string[] = [];
      const definitions = await DefinitionsFile.openFitting(sources[0]!, index, layers, (kind) => leftOut.push(kind));
      expect(leftOut).toEqual(["examples"]);
      const withoutExamples = async (id: number) =>
        (await whole.of(id))?.map((d) => ({ ...d, meanings: d.meanings.map(({ example: _, ...m }) => m) })) ?? null;
      for (const id of ids.slice(0, 50)) expect(await definitions.of(id), index.key(id)).toEqual(await withoutExamples(id));
    });

    it("doesn't take a network that's gone for a layer that doesn't fit", async () => {
      const sources = await sourcesFrom(serve(honest));
      const gone: ByteSource = { size: sources[1]!.size, read: async () => Promise.reject(new Unreachable(url("examples"), new TypeError("Failed to fetch"))) };
      const leftOut: string[] = [];
      await expect(DefinitionsFile.openFitting(sources[0]!, index, { ...asLayers(sources), examples: gone }, (kind) => leftOut.push(kind))).rejects.toBeInstanceOf(Unreachable);
      expect(leftOut).toEqual([]);
    });
  });

  it("when the server sends ranges", () => sameAsWhole(serve(honest)));
  it("when it says 206 but sends the whole file (Capacitor's)", () =>
    sameAsWhole(serve((file, range) => (range ? new Response(file as BodyInit, { status: 206, headers: { "Content-Range": `bytes ${range[0]}-${range[1] - 1}/${file.byteLength}` } }) : full(file)))));
  it("when it ignores ranges", () => sameAsWhole(serve((file) => full(file))));
  it("when it stops sending ranges after the files opened", () =>
    sameAsWhole(serve((file, range, n) => (range && n <= 2 ? partial(file, range) : full(file)))));
  it("when some requests fail after the files opened", () =>
    sameAsWhole(serve((file, range, n) => {
      if (n > 2 && n % 3 === 0) throw new TypeError("Failed to fetch");
      return honest(file, range, n);
    })));
  it("when a layer file isn't there: everything else still reads", () => {
    const fetchFn = serve((file, range, n) => (file === files.examples ? new Response(null, { status: 404 }) : honest(file, range, n)));
    const withoutExamples = async (id: number) =>
      (await whole.of(id))?.map((d) => ({ ...d, meanings: d.meanings.map(({ example: _, ...m }) => m) })) ?? null;
    return sameAsWhole(fetchFn, withoutExamples);
  });
  it("when every word is asked for at once", async () => {
    const read = await open(serve(honest));
    const all = await Promise.all(ids.map((id) => read.of(id)));
    for (const id of ids) expect(all[id], index.key(id)).toEqual(await whole.of(id));
  });
  it("holds a file whole when not reading in place (a browser)", async () => {
    const asked: (string | null)[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => (asked.push(new Headers(init?.headers).get("Range")), full(files[nameOf(url)]))) as typeof fetch;
    const source = await openSource("/headwords-sample.definitions.bin", { inPlace: false, fetchFn });
    expect(source?.size).toBe(files.definitions.byteLength);
    expect(asked).toEqual([null]); // one plain request, no ranges
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

describe("definitions before the word list is in", () => {
  // A browser shows the app from its starter (src/starter.ts) while the word list is still
  // on its way; the starter's words open their pages from the definitions straight away.
  const base = "test/fixtures/headwords-sample";
  const index = HeadwordIndex.fromBytes(new Uint8Array(readFileSync(`${base}.bin`)));
  const completer = new Completer(index, SAFE_SEARCH_OVERRIDES);
  // The fixture's definitions cover a few words: suggestions made of them hold them.
  const covered = [6177, 7732, 12272, 13011, 15791, 17056].map((id) => index.key(id));
  const starter = buildStarter(index, completer, [...PIECES.map(([p]) => p), ...covered], defaultFilters());
  const file = (ext: string) => bytesSource(new Uint8Array(readFileSync(`${base}${ext}`)));
  const open = (keys: WordKeys) =>
    DefinitionsFile.open(file(".definitions.bin"), keys, Object.fromEntries(LAYERS.map((kind) => [kind, file(`.${kind}.bin`)])));

  it("reads a starter word's page with the starter's keys, as with the word list", async () => {
    const early = await open(starterKeys(starter));
    const later = await open(index);
    const ids = Object.values(starter.pieces).flatMap((p) => p.landings.flatMap((l) => l.items.map((s) => s.id)));
    expect(ids.length).toBeGreaterThan(50);
    let withDefinitions = 0;
    for (const id of new Set(ids)) {
      const page = await early.of(id);
      expect(page, index.key(id)).toEqual(await later.of(id));
      if (page) withDefinitions++;
    }
    expect(withDefinitions).toBeGreaterThan(0);
  });

  it("refuses a starter made from another word list", async () => {
    const other = { ...starter, keysHash: starter.keysHash.replace(/^../, (b) => (b === "00" ? "01" : "00")) };
    await expect(open(starterKeys(other))).rejects.toThrow(/another word list/);
  });
});
