import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { serviceWorker } from "../tools/web-app";

// The web app as a browser installs it (a PWA): the web build (DICTIONARIUS_WEB=1, as
// pages.yml builds it) links a manifest that names the app, how it opens, its colours and its
// icons, and its service worker keeps those on the device with the page. The Android app's
// build has none of it: Android has the app's own icon and name.

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}
interface Manifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
}

const fixtures = resolve("test/fixtures");

async function built(web: boolean): Promise<string> {
  const out = mkdtempSync(join(tmpdir(), "dictionarius-app-"));
  const before = process.env.DICTIONARIUS_WEB;
  if (web) process.env.DICTIONARIUS_WEB = "1";
  else delete process.env.DICTIONARIUS_WEB;
  try {
    await build({ logLevel: "silent", publicDir: fixtures, build: { outDir: out, emptyOutDir: true } });
  } finally {
    if (before === undefined) delete process.env.DICTIONARIUS_WEB;
    else process.env.DICTIONARIUS_WEB = before;
  }
  return out;
}

/** A PNG's width and height, from its header (the IHDR chunk), or null if it isn't a PNG. */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!bytes.subarray(0, 8).equals(signature) || bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The `content` of the page's `<meta name=…>` (with `media`, the one for that media). */
function meta(html: string, name: string, media?: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/g) ?? []) {
    if (!tag.includes(`name="${name}"`)) continue;
    if (media !== undefined && !tag.includes(`media="${media}"`)) continue;
    return /content="([^"]*)"/.exec(tag)?.[1];
  }
  return undefined;
}

/** The `href` of the page's `<link rel=…>`. */
const link = (html: string, rel: string) =>
  (html.match(/<link\b[^>]*>/g) ?? []).find((tag) => tag.includes(`rel="${rel}"`))?.match(/href="([^"]*)"/)?.[1];

/** The files a service worker keeps (its FILES list, filled in by the build). */
const keptBy = (sw: string): string[] => JSON.parse(/const FILES = (\[.*?\]);/s.exec(sw)![1]);

describe("the web build, as a browser installs it", () => {
  let out = "";
  let html = "";
  let manifest: Manifest;

  beforeAll(async () => {
    out = await built(true);
    html = readFileSync(join(out, "index.html"), "utf8");
    manifest = JSON.parse(readFileSync(join(out, "app.webmanifest"), "utf8"));
  }, 120_000);
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it("links its manifest, a favicon and a home-screen icon from the page, relative to it", () => {
    expect(link(html, "manifest")).toBe("./app.webmanifest");
    for (const rel of ["icon", "apple-touch-icon"]) {
      const href = link(html, rel);
      expect(href, rel).toMatch(/^\.\/icons\//);
      expect(existsSync(join(out, href!)), href).toBe(true);
    }
    expect(pngSize(readFileSync(join(out, link(html, "apple-touch-icon")!)))).toEqual({ width: 180, height: 180 });
  });

  it("opens the page itself, in a window of its own, named as the page names itself", () => {
    expect(manifest).toMatchObject({ id: "./", start_url: "./", scope: "./", display: "standalone" });
    expect(manifest.name).toBe("Dictionarius");
    expect(manifest.short_name).toBe("Dictionarius"); // short enough for a home screen as it is
    expect(manifest.description).toBe(meta(html, "description"));
  });

  it("starts in the page's own paper colour, so the splash gives way to the page without a flash", () => {
    // The paper colour is styles.css's --paper; the page's theme-color says the same for the
    // browser's bars. Read here from both, so the manifest can't drift from either.
    const css = readFileSync("web/styles.css", "utf8");
    const paper = /:root\s*\{[^}]*--paper:\s*(#[0-9a-f]{6})/i.exec(css)![1];
    expect(meta(html, "theme-color", "(prefers-color-scheme: light)")).toBe(paper);
    expect(manifest.background_color).toBe(paper);
    expect(manifest.theme_color).toBe(paper);
  });

  it("has the icons Chrome asks for (192 and 512 px), and one Android can shape (maskable)", () => {
    const icons = manifest.icons;
    for (const icon of icons) {
      expect(icon.type, icon.src).toBe("image/png");
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(pngSize(readFileSync(join(out, icon.src))), icon.src).toEqual({ width, height });
    }
    const sizes = (purpose: string) => icons.filter((i) => (i.purpose ?? "any") === purpose).map((i) => i.sizes);
    expect(sizes("any")).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(sizes("maskable")).toContain("512x512");
    expect(icons.some((i) => i.purpose?.includes(" "))).toBe(false); // never "any maskable": each is drawn for its use
  });

  it("names no server: every address in the manifest is the site's own", () => {
    expect(JSON.stringify(manifest)).not.toMatch(/https?:|\/\//);
    for (const icon of manifest.icons) expect(icon.src).toMatch(/^icons\/[\w.-]+\.png$/);
  });

  it("keeps the manifest and icons on the device with the page, and none of the data", () => {
    const kept = keptBy(readFileSync(join(out, "sw.js"), "utf8"));
    const installFiles = ["app.webmanifest", link(html, "icon")!, link(html, "apple-touch-icon")!, ...manifest.icons.map((i) => i.src)];
    for (const file of installFiles) expect(kept).toContain(file.replace(/^\.\//, ""));
    for (const file of kept) expect(existsSync(join(out, file)), file).toBe(true);
    // The data files are the workers' to keep (web/data-cache.ts), by version.
    expect(kept.filter((file) => /\.(bin|gz)$|\.starter\.json$/.test(file))).toEqual([]);
  });
});

describe("the Android app's build", () => {
  it("has no manifest, web icons or service worker, and links none", async () => {
    const out = await built(false);
    try {
      const html = readFileSync(join(out, "index.html"), "utf8");
      expect(link(html, "manifest")).toBeUndefined();
      expect(link(html, "apple-touch-icon")).toBeUndefined();
      for (const file of ["app.webmanifest", "sw.js", "icons"]) expect(existsSync(join(out, file)), file).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("the service worker's build name", () => {
  // A new build name is a new service worker, which keeps the new files; the same name keeps
  // serving the old ones. The manifest and icons keep their names from build to build, so the
  // name must follow what's in them, not only what they're called.
  const build = (sw: string) => /const BUILD = "([0-9a-f]+)"/.exec(sw)![1];
  const files = (icon: string) => [
    { name: "assets/index-abc123.js", source: "console.log(1)" },
    { name: "icons/icon-192.png", source: icon },
  ];

  it("changes when a file's contents change under the same name", () => {
    expect(build(serviceWorker(files("one")))).not.toBe(build(serviceWorker(files("two"))));
  });

  it("stays the same for the same files", () => {
    expect(build(serviceWorker(files("one")))).toBe(build(serviceWorker(files("one"))));
  });
});

describe("the web app's icons", () => {
  it("were drawn from the brand icon as it is now (else: node tools/make-icons.ts)", () => {
    const brand = createHash("sha256").update(readFileSync("docs/brand/icon.svg")).digest("hex");
    expect(readFileSync("web/icons/source.sha256", "utf8").trim()).toBe(brand);
  });
});
