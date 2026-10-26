import { createRequire } from "node:module";
import { describeDictionarySourceContract } from "./source-contract";
import { SqliteDictionarySource } from "../src/sqlite-source";
import type { Entry } from "../src/source";

// node:sqlite is a recent builtin Vite's transformer doesn't recognize; load it
// through a real Node require so it stays a genuine external import.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

describeDictionarySourceContract("SqliteDictionarySource", async (entries: Entry[]) => {
  const db = new DatabaseSync(":memory:");
  const src = new SqliteDictionarySource(db);
  await src.init();
  await src.ingest(entries);
  return src;
});
