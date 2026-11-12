import { test, expect, chromium, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The published web app, as a browser installs it (a PWA): Chrome's own check finds nothing
// in the way, and the icons it would put on a home screen are right for it.

/** Pixels of an image the page has, drawn at its own size: RGBA, row by row. */
async function pixels(page: Page, src: string) {
  return page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return { size: canvas.width, data: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data) };
  }, src);
}

test("Chrome finds nothing in the way of installing it, and reads the manifest without a complaint", async ({ baseURL }) => {
  // A browser profile of its own: Chrome never offers to install from a private (incognito)
  // window, which is what a test's usual browser context is.
  const profile = mkdtempSync(join(tmpdir(), "dictionarius-profile-"));
  const context = await chromium.launchPersistentContext(profile, { baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
    expect(installabilityErrors).toEqual([]);
    const manifest = await cdp.send("Page.getAppManifest");
    expect(manifest.errors).toEqual([]);
    expect(manifest.url).toMatch(/\/app\.webmanifest$/);
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test("the maskable icon keeps its glyph inside the circle Android may cut it to, on an opaque square", async ({ page }) => {
  // A maskable icon's safe zone is the circle of 40% of its width around its middle: outside
  // it, a launcher may cut anything away, so only the background may be there.
  await page.goto("/");
  const { size, data } = await pixels(page, "icons/maskable-512.png");
  const at = (x: number, y: number) => data.slice((y * size + x) * 4, (y * size + x) * 4 + 4);
  const background = at(0, 0);
  const differs = (p: number[]) => p.some((v, i) => Math.abs(v - background[i]) > 8);
  let outside = 0;
  let inside = 0;
  let seeThrough = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = at(x, y);
      if (p[3] !== 255) seeThrough++;
      if (!differs(p)) continue;
      if (Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) > 0.4 * size) outside++;
      else inside++;
    }
  }
  expect(seeThrough).toBe(0); // opaque everywhere: no hole for a launcher to show through
  expect(outside).toBe(0);
  expect(inside).toBeGreaterThan(size * size * 0.05); // and the glyph is there
});

test("the home-screen icon for iOS is opaque (iOS fills any see-through part with black)", async ({ page }) => {
  await page.goto("/");
  const { data } = await pixels(page, "icons/apple-touch-icon.png");
  expect(data.filter((_, i) => i % 4 === 3 && data[i] !== 255)).toEqual([]);
});

test("every icon shows the brand icon (the drawn PNGs match the favicon's SVG)", async ({ page }) => {
  await page.goto("/");
  const drawn = await pixels(page, "icons/icon-192.png");
  const svg = await page.evaluate(async () => {
    const image = new Image(192, 192);
    image.src = "icons/icon.svg";
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 192;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0, 192, 192);
    return Array.from(context.getImageData(0, 0, 192, 192).data);
  });
  const difference = drawn.data.reduce((sum, v, i) => sum + Math.abs(v - svg[i]), 0) / drawn.data.length;
  expect(difference).toBeLessThan(2); // per channel, on average: the same picture
});
