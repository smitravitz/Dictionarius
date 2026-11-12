import { defineConfig } from "vite";
import { preloadFonts } from "./tools/preload-fonts";
import { webData } from "./tools/web-data";
import { webApp } from "./tools/web-app";

// The web app lives in web/. The headword index is served from dist/ (where
// scripts/build_fm_index.py writes it), or from $DICTIONARIUS_PUBLIC.
export default defineConfig({
  root: "web",
  // Files named relative to the page, so the build works from any folder: the
  // Android app's root and GitHub Pages' /Dictionarius/ alike.
  base: "./",
  publicDir: process.env.DICTIONARIUS_PUBLIC ?? "../dist",
  build: { outDir: "../build/web", emptyOutDir: true },
  worker: { format: "es" },
  // The start screen's fonts, ready for its first frame (no jump when they swap in); for a
  // browser, each word list's starter and gzipped copy (tools/web-data.ts), and what makes
  // the page an app it can install: manifest, icons, service worker (tools/web-app.ts).
  plugins: [preloadFonts(), webData(), webApp()],
});
