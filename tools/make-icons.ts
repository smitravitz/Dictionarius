/**
 * The web app's icons, drawn from the brand icon (docs/brand/icon.svg, the Android app's
 * adaptive icon: its glyph sits well inside the middle 80%, so it can be cut to any shape).
 * Run it after changing the brand icon, and commit what it writes to web/icons/:
 *
 *   node tools/make-icons.ts
 *
 * - icon.svg, icon-192.png, icon-512.png: rounded corners, for a desktop and the browser's tab
 *   ("any": shown as drawn);
 * - maskable-512.png: square to the edges, for Android to cut to its own shape ("maskable");
 * - apple-touch-icon.png (180 px): square and opaque, as iOS rounds it itself.
 *
 * Drawn by Chromium (Playwright's, already a dev dependency), so no image library is needed;
 * source.sha256 records which brand icon they come from (test/web-app.test.ts checks it).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const BRAND = resolve(import.meta.dirname, "../docs/brand/icon.svg");
const OUT = resolve(import.meta.dirname, "../web/icons");
/** Corner radius for the "any" icons, in the brand icon's 108-unit square: about a fifth,
 *  the rounding an app icon has on a desktop. */
const ROUNDED = 24;

const brand = readFileSync(BRAND, "utf8");
if (!brand.includes('rx="0"')) throw new Error(`${BRAND}: expected its square clip (rx="0") to round`);
const square = brand;
const rounded = brand.replace('rx="0"', `rx="${ROUNDED}"`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  /** `svg` drawn at `size` px square, as a PNG (transparent where the icon isn't). */
  const png = async (svg: string, size: number): Promise<Buffer> => {
    const data = await page.evaluate(
      async ({ svg, size }) => {
        const image = new Image(size, size);
        image.src = `data:image/svg+xml;base64,${btoa(svg)}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        canvas.getContext("2d")!.drawImage(image, 0, 0, size, size);
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { svg, size },
    );
    return Buffer.from(data, "base64");
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "icon.svg"), rounded);
  writeFileSync(join(OUT, "icon-192.png"), await png(rounded, 192));
  writeFileSync(join(OUT, "icon-512.png"), await png(rounded, 512));
  writeFileSync(join(OUT, "maskable-512.png"), await png(square, 512));
  writeFileSync(join(OUT, "apple-touch-icon.png"), await png(square, 180));
  writeFileSync(join(OUT, "source.sha256"), `${createHash("sha256").update(brand).digest("hex")}\n`);
  console.log(`Icons written to ${OUT}`);
} finally {
  await browser.close();
}
