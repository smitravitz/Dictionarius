/**
 * A Vite step for web/theme-boot.js, the light or dark picked in Settings put on the page before
 * its first frame: a plain script (not a module, which would run only after the page is
 * drawn), linked at the end of the page's <head>, after the theme-color tags it changes. In
 * every build, the Android app's too; the dev server serves it from web/ as it is.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const SCRIPT = "theme-boot.js";

export function themeScript(): Plugin {
  return {
    name: "dictionarius-theme-script",
    // Added after Vite has read the page's own scripts: it isn't one to bundle.
    transformIndexHtml: {
      order: "post",
      handler: () => [{ tag: "script", attrs: { src: `./${SCRIPT}` }, injectTo: "head" }],
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: SCRIPT, source: readFileSync(resolve(import.meta.dirname, "../web", SCRIPT), "utf8") });
    },
  };
}
