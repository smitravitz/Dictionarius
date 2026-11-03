import { describe, it, expect } from "vitest";
import { fontPreloads, START_SCREEN_FONTS } from "../tools/preload-fonts";

// The start screen's text fonts are preloaded from the page's head, so its
// first frame is drawn in them: drawn first in a stand-in font, then swapped,
// the whole page jumped (the "stutter" on opening).

describe("fontPreloads", () => {
  const built = [
    "assets/index-BgxJBHaB.css",
    "assets/literata-latin-opsz-normal-BHZsWIlc.woff2",
    "assets/literata-greek-opsz-normal-DFglUmAd.woff2",
    "assets/atkinson-hyperlegible-next-latin-400-normal-FfmJh7DR.woff2",
    "assets/atkinson-hyperlegible-next-latin-400-normal-Xyz12345.woff",
    "assets/atkinson-hyperlegible-next-latin-700-normal-Dpiyiu63.woff2",
    "assets/atkinson-hyperlegible-next-latin-ext-700-normal-CBw-mJf_.woff2",
  ];

  it("preloads the Latin text fonts the start screen uses, and nothing else", () => {
    expect(fontPreloads(built, START_SCREEN_FONTS, "/")).toEqual([
      { tag: "link", attrs: { rel: "preload", href: "/assets/literata-latin-opsz-normal-BHZsWIlc.woff2", as: "font", type: "font/woff2", crossorigin: "" }, injectTo: "head-prepend" },
      { tag: "link", attrs: { rel: "preload", href: "/assets/atkinson-hyperlegible-next-latin-400-normal-FfmJh7DR.woff2", as: "font", type: "font/woff2", crossorigin: "" }, injectTo: "head-prepend" },
      { tag: "link", attrs: { rel: "preload", href: "/assets/atkinson-hyperlegible-next-latin-700-normal-Dpiyiu63.woff2", as: "font", type: "font/woff2", crossorigin: "" }, injectTo: "head-prepend" },
    ]);
  });

  it("follows the app's base path, and finds nothing to preload in a build without the fonts", () => {
    expect(fontPreloads(built, START_SCREEN_FONTS, "./")[0].attrs!.href).toBe("./assets/literata-latin-opsz-normal-BHZsWIlc.woff2");
    expect(fontPreloads(["assets/index.css"], START_SCREEN_FONTS, "/")).toEqual([]);
  });
});
