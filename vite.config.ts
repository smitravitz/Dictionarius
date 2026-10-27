import { defineConfig } from "vite";

// The web app lives in web/. The headword index is served from dist/ (where
// scripts/build_fm_index.py writes it), or from $DICTIONARILY_PUBLIC.
export default defineConfig({
  root: "web",
  publicDir: process.env.DICTIONARILY_PUBLIC ?? "../dist",
  build: { outDir: "../build/web", emptyOutDir: true },
  worker: { format: "es" },
});
