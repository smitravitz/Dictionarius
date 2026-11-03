/**
 * A Vite build step: preload the start screen's text fonts from the page's
 * head. The fonts come with the app (@fontsource, imported by web/main.ts),
 * but a font is only fetched once text needs it, so the first frame was drawn
 * in a stand-in font and then swapped, and the whole page jumped. Preloaded,
 * they arrive with the stylesheet. Only the Latin files the start screen
 * shows are preloaded; other alphabets still load when a word needs them.
 */
import type { HtmlTagDescriptor, Plugin } from "vite";

/** The built files to preload: Literata (the words, variable) and Atkinson Hyperlegible Next 400 and 700 (the rest). */
export const START_SCREEN_FONTS: readonly RegExp[] = [
  /(^|\/)literata-latin-opsz-normal-[\w-]+\.woff2$/,
  /(^|\/)atkinson-hyperlegible-next-latin-400-normal-[\w-]+\.woff2$/,
  /(^|\/)atkinson-hyperlegible-next-latin-700-normal-[\w-]+\.woff2$/,
];

/** A preload tag for each built file matching one of `patterns`, in the patterns' order. */
export function fontPreloads(files: readonly string[], patterns: readonly RegExp[], base: string): HtmlTagDescriptor[] {
  const tags: HtmlTagDescriptor[] = [];
  for (const pattern of patterns) {
    const file = files.find((f) => pattern.test(f));
    if (!file) continue;
    tags.push({
      tag: "link",
      attrs: { rel: "preload", href: base + file, as: "font", type: "font/woff2", crossorigin: "" },
      injectTo: "head-prepend",
    });
  }
  return tags;
}

export function preloadFonts(patterns: readonly RegExp[] = START_SCREEN_FONTS): Plugin {
  let base = "/";
  return {
    name: "dictionarius-preload-fonts",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler: (_html, ctx) => (ctx.bundle ? fontPreloads(Object.keys(ctx.bundle), patterns, base) : []),
    },
  };
}
