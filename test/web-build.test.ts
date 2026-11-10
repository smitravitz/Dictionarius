import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { HeadwordIndex } from "../src/headword-index";
import { readStarter } from "../src/starter";

// The web build is published to GitHub Pages under /Dictionarius/, not at a
// site's root, and packed into the Android app: every file it names must be
// relative to the page, so it works from any folder.

describe("the production web build", () => {
  it("names its scripts, styles, fonts and worker relative to the page", async () => {
    const out = mkdtempSync(join(tmpdir(), "dictionarius-build-"));
    try {
      await build({ logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
      const html = readFileSync(join(out, "index.html"), "utf8");
      const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
      const own = refs.filter((r) => !/^https?:/.test(r));
      expect(own.length).toBeGreaterThan(3); // script, stylesheet, font preloads
      for (const ref of own) expect(ref, ref).toMatch(/^\.\//);
      // Inside the bundle too: no "/assets/..." from the root (the worker, fonts in the CSS).
      for (const file of readdirSync(join(out, "assets")).filter((f) => /\.(js|css)$/.test(f))) {
        expect(readFileSync(join(out, "assets", file), "utf8"), file).not.toMatch(/["'(]\/assets\//);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});

// A browser shows the app from a small starter file while the word list comes, gzipped,
// in the background (src/starter.ts). Only the web build has them: the Android app reads
// its word list from the phone and would only carry them as dead weight.
describe("the web build's data", () => {
  const fixtures = resolve("test/fixtures");
  const built = async (web: boolean) => {
    const out = mkdtempSync(join(tmpdir(), "dictionarius-build-"));
    const before = process.env.DICTIONARIUS_WEB;
    if (web) process.env.DICTIONARIUS_WEB = "1";
    else delete process.env.DICTIONARIUS_WEB;
    try {
      await build({ logLevel: "silent", publicDir: fixtures, build: { outDir: out, emptyOutDir: true } });
    } finally {
      if (before === undefined) delete process.env.DICTIONARIUS_WEB;
      else process.env.DICTIONARIUS_WEB = before;
    }
    return out;
  };
  const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

  it("has each word list's starter and a gzipped copy, named by hash", async () => {
    const out = await built(true);
    try {
      const bin = join(out, "headwords-sample.bin");
      expect(gunzipSync(readFileSync(`${bin}.gz`)).equals(readFileSync(bin))).toBe(true);
      const starter = readStarter(JSON.parse(readFileSync(join(out, "headwords-sample.starter.json"), "utf8")));
      expect(starter).not.toBeNull();
      expect(starter!.words).toBe(HeadwordIndex.fromBytes(new Uint8Array(readFileSync(bin))).size);
      expect(Object.keys(starter!.pieces).length).toBeGreaterThan(20);
      const named = ["headwords-sample.bin", "headwords-sample.bin.gz", "headwords-sample.definitions.bin", "headwords-sample.examples.bin"];
      for (const name of named) {
        expect(starter!.files[name], name).toEqual({ sha256: sha(join(out, name)), bytes: statSync(join(out, name)).size });
      }
      expect(Object.keys(starter!.files).some((name) => name.endsWith(".json"))).toBe(false); // data files only
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);

  it("leaves them out of the app's build", async () => {
    const out = await built(false);
    try {
      expect(existsSync(join(out, "headwords-sample.bin"))).toBe(true);
      expect(existsSync(join(out, "headwords-sample.bin.gz"))).toBe(false);
      expect(existsSync(join(out, "headwords-sample.starter.json"))).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
