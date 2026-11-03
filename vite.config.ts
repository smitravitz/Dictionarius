import { defineConfig } from "vite";
import { preloadFonts } from "./tools/preload-fonts";

// The web app lives in web/. The headword index is served from dist/ (where
// scripts/build_fm_index.py writes it), or from $DICTIONARIUS_PUBLIC.
export default defineConfig({
  root: "web",
  publicDir: process.env.DICTIONARIUS_PUBLIC ?? "../dist",
  build: { outDir: "../build/web", emptyOutDir: true },
  worker: { format: "es" },
  // The start screen's fonts, ready for its first frame (no jump when they swap in).
  plugins: [preloadFonts()],
});
