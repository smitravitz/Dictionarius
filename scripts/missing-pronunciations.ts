/**
 * Words with definitions but no pronunciation, one per line (as the app shows them),
 * into a text file; prints how many.
 *
 *   npx vite-node scripts/missing-pronunciations.ts [dist/headwords.bin] [missing-pronunciations.txt]
 *
 * With --tsv FILE it also writes every word with definitions as a table for working
 * out pronunciations (scripts/derive_pronunciations.py reads it): the word, its
 * pronunciations (" | " between them; empty when it has none), its etymologies and
 * the words its meanings point to ("plural of …"), tab-separated.
 *
 * Reads the files beside the index: the definitions and their pronunciation and
 * etymology layers (docs/definitions-format.md).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { HeadwordIndex } from "../src/headword-index";
import { LayerFile, layerUrl, unpack, type PackingTables } from "../src/definitions";

const args = process.argv.slice(2);
const tsvAt = args.indexOf("--tsv");
const tsvPath = tsvAt >= 0 ? args.splice(tsvAt, 2)[1] : null;
const [indexPath = "dist/headwords.bin", outPath = "missing-pronunciations.txt"] = args;
const corePath = indexPath.replace(/\.bin$/, ".definitions.bin");

const read = (path: string) => new Uint8Array(readFileSync(path));
const index = HeadwordIndex.fromBytes(read(indexPath));
const core = LayerFile.fromBytes(read(corePath), index);
const pronunciation = LayerFile.fromBytes(read(layerUrl(corePath, "pronunciation")), index);
const etymology = tsvPath ? LayerFile.fromBytes(read(layerUrl(corePath, "etymology")), index) : null;

const missing: string[] = [];
const rows: string[] = [];
let defined = 0;
const clean = (s: string) => s.replace(/[\t\n]+/g, " ");
for (let id = 0; id < index.size; id++) {
  const coreLine = await core.line(id);
  if (!coreLine) continue; // no definitions
  defined++;
  const soundLine = await pronunciation.line(id);
  const shown = index.displayForms(id)[0] ?? index.key(id);
  if (!soundLine) missing.push(shown);
  if (tsvPath) {
    const lines = { core: coreLine, pronunciation: soundLine, etymology: await etymology!.line(id) };
    const definitions = unpack(index.key(id), lines, core.tables as unknown as PackingTables);
    const ipa = [...new Set(definitions.flatMap((d) => d.ipa ?? []))];
    const etymologies = [...new Set(definitions.map((d) => d.etymology).filter((e): e is string => !!e))];
    const of = [...new Set(definitions.flatMap((d) => d.meanings.flatMap((m) => m.of ?? [])))];
    rows.push([index.key(id), ipa.join(" | "), etymologies.map(clean).join(" | "), of.join(" | ")].join("\t"));
  }
}

writeFileSync(outPath, missing.join("\n") + "\n");
const share = (n: number) => `${((100 * n) / defined).toFixed(1)}%`;
console.log(`${defined.toLocaleString("en")} words with definitions; ` +
  `${(defined - missing.length).toLocaleString("en")} (${share(defined - missing.length)}) have a pronunciation, ` +
  `${missing.length.toLocaleString("en")} (${share(missing.length)}) don't: ${outPath}`);
if (tsvPath) {
  writeFileSync(tsvPath, "word\tipa\tetymology\tof\n" + rows.join("\n") + "\n");
  console.log(`every word with definitions, for working out pronunciations: ${tsvPath}`);
}
