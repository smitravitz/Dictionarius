import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";

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
