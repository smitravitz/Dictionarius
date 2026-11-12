/**
 * A Vite step for the web app as a browser runs and installs it (a PWA): for the web build
 * (DICTIONARIUS_WEB=1, set by pages.yml) and the dev server, the page links a manifest (the
 * app's name, how it opens, its colours and icons) and a favicon, and the build gets a service
 * worker (`sw.js`, from web/sw.js) that keeps the page and those files on the device, so the
 * installed app opens with no network. The Android app's build has none of it: Android shows
 * the app's own name and icon, and its files are on the phone already.
 *
 * The manifest takes the app's name, description and colours from the page itself (its
 * <title> and <meta> tags), so the two can't disagree. The icons are web/icons/, drawn from
 * the brand icon by tools/make-icons.ts.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const WEB = resolve(import.meta.dirname, "../web");

/** The manifest's address, beside the page. */
const MANIFEST = "app.webmanifest";

/** The icons (web/icons/), as the manifest lists them: "any" is shown as drawn (rounded
 *  corners), "maskable" is square to the edges for Android to cut to its own shape. */
const ICONS = [
  { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];
/** Linked from the page: the browser tab's icon, and the home screen's on iOS. */
const FAVICON = "icons/icon.svg";
const TOUCH_ICON = "icons/apple-touch-icon.png";

/** Files the workers keep themselves, by version (web/data-cache.ts): never the shell's.
 *  web/sw.js lets the same files through. */
const DATA_FILE = /\.(bin|gz)$|\.starter\.json$/;

/** What the page says of itself: its <title>, or a <meta>'s content. Throws if it's missing,
 *  so a manifest is never built without it. */
function fromPage(html: string, what: "title" | { name: string; media?: string }): string {
  if (what === "title") {
    const title = /<title>([^<]+)<\/title>/.exec(html)?.[1].trim();
    if (title) return title;
  } else {
    for (const tag of html.match(/<meta\b[^>]*>/g) ?? []) {
      if (!tag.includes(`name="${what.name}"`) || (what.media && !tag.includes(`media="${what.media}"`))) continue;
      const content = /content="([^"]+)"/.exec(tag)?.[1];
      if (content) return content;
    }
  }
  throw new Error(`index.html has no ${typeof what === "string" ? what : `<meta name="${what.name}">`} for the manifest`);
}

/** The web app manifest, from the page (its HTML). Addresses are relative to the manifest,
 *  which sits beside the page: the app opens the page itself, wherever it's published. */
export function manifestFor(html: string): Record<string, unknown> {
  const name = fromPage(html, "title");
  // The dark paper colour, the page's own by default (web/theme-choice.ts): the splash a
  // phone shows while the page starts, and the bars'.
  const paper = fromPage(html, { name: "theme-color", media: "(prefers-color-scheme: dark)" });
  return {
    id: "./",
    name,
    short_name: name,
    description: fromPage(html, { name: "description" }),
    lang: "en",
    dir: "ltr",
    start_url: "./",
    scope: "./",
    display: "standalone",
    background_color: paper,
    theme_color: paper,
    categories: ["books", "education", "reference"],
    icons: ICONS,
  };
}

/** web/sw.js with a build's files filled in (all but the page, kept as "./"), and a build
 *  name made from their names and contents, so each change is a new service worker, which
 *  keeps the new files (some, such as the manifest, keep their names from build to build). */
export function serviceWorker(files: readonly { name: string; source: string | Uint8Array }[]): string {
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const hash = createHash("sha256");
  for (const { name, source } of sorted) hash.update(name).update("\0").update(source).update("\0");
  return readFileSync(resolve(WEB, "sw.js"), "utf8")
    .replace("__BUILD__", hash.digest("hex").slice(0, 12))
    .replace("__FILES__", JSON.stringify(sorted.map((f) => f.name)));
}

export function webApp(): Plugin {
  let web = false;
  return {
    name: "dictionarius-web-app",
    // After Vite's own build steps, so the page (index.html) is in the bundle to read.
    enforce: "post",
    configResolved(config) {
      web = config.command === "serve" || process.env.DICTIONARIUS_WEB === "1";
    },
    transformIndexHtml() {
      if (!web) return;
      return [
        { tag: "link", attrs: { rel: "manifest", href: `./${MANIFEST}` }, injectTo: "head" },
        { tag: "link", attrs: { rel: "icon", href: `./${FAVICON}`, type: "image/svg+xml" }, injectTo: "head" },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: `./${TOUCH_ICON}` }, injectTo: "head" },
      ];
    },
    configureServer(server) {
      // The icons are web/icons/, served as they are; the manifest is made from the page.
      server.middlewares.use((request, response, next) => {
        if ((request.url ?? "").split("?")[0] !== `/${MANIFEST}`) return next();
        response.setHeader("Content-Type", "application/manifest+json");
        response.setHeader("Cache-Control", "no-cache");
        response.end(JSON.stringify(manifestFor(readFileSync(resolve(WEB, "index.html"), "utf8"))));
      });
    },
    generateBundle(_options, bundle) {
      if (!web) return;
      const page = bundle["index.html"];
      if (page?.type !== "asset") throw new Error("the web build has no index.html");
      const own: { name: string; source: string | Uint8Array }[] = [];
      const emit = (name: string, source: string | Uint8Array) => {
        this.emitFile({ type: "asset", fileName: name, source });
        own.push({ name, source });
      };
      for (const icon of [FAVICON, TOUCH_ICON, ...ICONS.map((i) => i.src)]) emit(icon, readFileSync(resolve(WEB, icon)));
      emit(MANIFEST, `${JSON.stringify(manifestFor(String(page.source)), null, 2)}\n`);
      // The page's own files: everything built but the page (kept as "./") and the data.
      const built = Object.values(bundle)
        .filter((file) => file.fileName !== "index.html" && !DATA_FILE.test(file.fileName) && !own.some((o) => o.name === file.fileName))
        .map((file) => ({ name: file.fileName, source: file.type === "chunk" ? file.code : file.source }));
      this.emitFile({ type: "asset", fileName: "sw.js", source: serviceWorker([...built, ...own]) });
    },
  };
}
