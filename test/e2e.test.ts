import { createRequire } from "node:module";
import { Dictionary } from "../src/dictionary";
import { SqliteDictionarySource } from "../src/sqlite-source";
import { attributionNotice } from "../src/attribution";
import { entry } from "./source-contract";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

async function realDict() {
  const src = new SqliteDictionarySource(new DatabaseSync(":memory:"));
  await src.init();
  await src.ingest([entry("serendipity"), entry("serene"), entry("café"), entry("dog")]);
  return { dict: new Dictionary(src), src };
}

// End-to-end: the SAME Dictionary logic, now over the REAL SQLite source.
test("lookup + search + suggest + attribution work over the real SQLite source", async () => {
  const { dict, src } = await realDict();

  const hit = await dict.lookup("serendipity");
  expect(hit!.headword).toBe("serendipity");
  expect(attributionNotice(hit!)).toContain("creativecommons.org/licenses/by-sa/4.0");

  expect((await dict.search("cafe")).map((h) => h.headword)).toEqual(["café"]);
  expect(await dict.suggest("ser")).toEqual(["serendipity", "serene"]);
});
