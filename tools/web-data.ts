/**
 * A Vite step for the web app's data: beside each word list (`<name>.bin`) in the data
 * folder, a starter (`<name>.starter.json`, src/starter.ts) and a gzipped copy
 * (`<name>.bin.gz`, about 40% of the size). A browser shows the app as soon as the
 * starter is in and fetches the word list gzipped in the background (web/search-worker.ts).
 * The starter lists each data file's hash and size, so a page keeps them on the device
 * by version (web/data-cache.ts).
 *
 * The dev server makes the starters (not the gzipped copies: a build's job); a build writes them only for the web
 * (DICTIONARIUS_WEB=1, set by pages.yml): the Android app reads its word list from the
 * phone, and would only carry them as dead weight. The web build also gets its service
 * worker (`sw.js`, from web/sw.js), which keeps the page itself on the device.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { runnerImport, type Plugin } from "vite";
import type { DataFile, Starter } from "../src/starter";

/** The files a word list comes with, besides itself (src/definitions.ts's LAYERS). */
const COMPANIONS = ["definitions", "examples", "etymology", "pronunciation"];

/** The word lists among a folder's file names: `<name>.bin`, not one of their companions. */
export function wordLists(names: readonly string[]): string[] {
  const companion = new RegExp(`\\.(${COMPANIONS.join("|")})\\.bin$`);
  return names.filter((name) => name.endsWith(".bin") && !companion.test(name)).sort();
}

/** The data files of word list `list` (its name) found in `folder`, with the gzipped copy if there's one. */
function dataFiles(folder: string, list: string, gzipped: Buffer | null): Record<string, DataFile> {
  const stem = list.replace(/\.bin$/, "");
  const files: Record<string, DataFile> = {};
  const add = (name: string, bytes: Buffer) => (files[name] = { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength });
  add(list, readFileSync(join(folder, list)));
  if (gzipped) add(`${list}.gz`, gzipped);
  for (const kind of COMPANIONS) {
    const name = `${stem}.${kind}.bin`;
    if (existsSync(join(folder, name))) add(name, readFileSync(join(folder, name)));
  }
  return files;
}

type MakeStarter = (indexBytes: Uint8Array, files: Record<string, DataFile>) => Starter;

/** The app's own starter maker, loaded through Vite (its imports need Vite's handling). */
async function starterMaker(): Promise<MakeStarter> {
  const { module } = await runnerImport<{ makeStarter: MakeStarter }>(resolve(import.meta.dirname, "make-starter.ts"), {
    configFile: false,
    logLevel: "silent",
  });
  return module.makeStarter;
}

/** A word list's starter, and its gzipped copy when `gzip` (a build: a few seconds for a
 *  full word list, so the dev server goes without and serves the word list as it is). */
async function made(folder: string, list: string, gzip: boolean): Promise<{ gzipped: Buffer | null; starter: string }> {
  const bytes = readFileSync(join(folder, list));
  const gzipped = gzip ? gzipSync(bytes, { level: 9 }) : null;
  const make = await starterMaker();
  const starter = JSON.stringify(make(new Uint8Array(bytes), dataFiles(folder, list, gzipped)));
  return { gzipped, starter };
}

/** web/sw.js with a build's files filled in, and a build name made from them (their names
 *  carry their contents' hash), so each new build is a new service worker. */
export function serviceWorker(files: readonly string[]): string {
  const build = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12);
  return readFileSync(resolve(import.meta.dirname, "../web/sw.js"), "utf8")
    .replace("__BUILD__", build)
    .replace("__FILES__", JSON.stringify(files));
}

export function webData(): Plugin {
  let folder = "";
  let web = false;
  return {
    name: "dictionarius-web-data",
    configResolved(config) {
      folder = config.publicDir;
      web = config.command === "serve" || process.env.DICTIONARIUS_WEB === "1";
    },
    configureServer(server) {
      // Each word list's starter, made as the server starts (so the first page needn't wait),
      // and again when the word list changes.
      const kept = new Map<string, { at: number; starter: Promise<string> }>();
      const starterOf = (list: string) => {
        const at = statSync(join(folder, list)).mtimeMs;
        let entry = kept.get(list);
        if (!entry || entry.at !== at) {
          entry = { at, starter: made(folder, list, false).then(({ starter }) => starter) };
          entry.starter.catch(() => {}); // reported when asked for
          kept.set(list, entry);
        }
        return entry.starter;
      };
      if (folder && existsSync(folder)) for (const list of wordLists(readdirSync(folder))) void starterOf(list);
      server.middlewares.use((request, response, next) => {
        const path = decodeURIComponent((request.url ?? "").split("?")[0]);
        const asked = /^\/([^/]+)\.starter\.json$/.exec(path);
        const list = asked ? `${asked[1]}.bin` : "";
        if (!asked || !folder || !existsSync(join(folder, list))) return next();
        starterOf(list).then(
          (starter) => {
            response.setHeader("Content-Type", "application/json");
            response.setHeader("Cache-Control", "no-cache");
            response.end(starter);
          },
          (error: unknown) => next(error),
        );
      });
    },
    async generateBundle(_options, bundle) {
      if (!web) return;
      // The service worker, with this build's files (all but the page, kept as "./").
      const files = Object.keys(bundle).filter((name) => name !== "index.html").sort();
      this.emitFile({ type: "asset", fileName: "sw.js", source: serviceWorker(files) });
      if (!folder || !existsSync(folder)) return;
      for (const list of wordLists(readdirSync(folder))) {
        const { gzipped, starter } = await made(folder, list, true);
        this.emitFile({ type: "asset", fileName: `${list}.gz`, source: gzipped! });
        this.emitFile({ type: "asset", fileName: list.replace(/\.bin$/, ".starter.json"), source: starter });
      }
    },
  };
}
