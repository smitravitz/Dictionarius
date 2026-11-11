// Runs bench/search-speed.ts through Vite (the app's code imports files the Vite way).
// Usage: npm run bench:speed [-- path/to/headwords.bin]   (default: release-data/headwords.bin)
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const { module } = await runnerImport(fileURLToPath(new URL("./search-speed.ts", import.meta.url)), { configFile: false, logLevel: "silent" });
module.run(process.argv[2] ?? "release-data/headwords.bin");
