import { test, expect, type Page } from "@playwright/test";
import { asTheApp } from "./as-the-app";

// In a browser, once the word list is in, the rest of the dictionary downloads in the
// background to be kept on the device. A thin bar under the title says how far along it is
// and how good the connection is (from the download's own speed), and once it's all in it
// says so and fades out over 5 seconds. It sits over the page: nothing moves when it comes
// or goes. Settings says only how it ended.

/** The download of the files kept on the device (whole files, no Range): `delayMs` each, or
 *  `down` (no connection: refused, and the browser offline). */
async function network(page: Page) {
  const state = { delayMs: 700, down: false };
  await page.context().route(
    (url) => /\.(bin|gz)$/.test(url.pathname),
    async (route) => {
      if (route.request().headers()["range"]) return route.continue().catch(() => {}); // a word's page: at once
      if (state.down) return route.abort("internetdisconnected");
      await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      if (state.down) return route.abort("internetdisconnected");
      await route.continue().catch(() => {});
    },
  );
  return state;
}

/** What the bar shows in every painted frame: its text, its opacity, and where the title and
 *  the search box are (they mustn't move). */
async function recordBar(page: Page) {
  await page.addInitScript(() => {
    const frames: { t: number; shown: boolean; text: string; opacity: number; fill: string; title: string; box: string }[] = [];
    (window as unknown as { barFrames: typeof frames }).barFrames = frames;
    const where = (id: string) => {
      const r = document.getElementById(id)?.getBoundingClientRect();
      return r ? `${Math.round(r.x)},${Math.round(r.y)}` : "";
    };
    const look = (t: number) => {
      const bar = document.getElementById("download");
      if (bar) {
        frames.push({
          t,
          shown: !bar.hidden,
          text: document.getElementById("download-text")?.textContent ?? "",
          opacity: Number(getComputedStyle(bar).opacity),
          fill: getComputedStyle(bar.querySelector(".download-fill")!).transform,
          title: where("masthead-title"),
          box: where("q"),
        });
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}
type BarFrame = { t: number; shown: boolean; text: string; opacity: number; fill: string; title: string; box: string };
const barFrames = (page: Page) => page.evaluate(() => (window as unknown as { barFrames: BarFrame[] }).barFrames);

async function open(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/, { timeout: 30_000 });
}

const PROGRESS = /^Downloading (\d+)%( · (Fast connection|Slow connection|Very slow connection|No connection))?$/;

test("while the dictionary downloads, a bar under the title says how far along and how good the connection is", async ({ page }) => {
  await network(page);
  await recordBar(page);
  await open(page);
  const text = page.locator("#download-text");
  await expect(text).toHaveText(PROGRESS);
  await expect(text).toHaveText(/ · (Fast|Slow|Very slow) connection$/, { timeout: 15_000 });
  const bar = page.locator("#download");
  const title = (await page.locator(".wordmark").boundingBox())!; // the word itself
  const box = (await bar.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(title.y + title.height - 1); // under the title
  expect(Math.abs(box.x - title.x)).toBeLessThan(2); // from its left edge
  await expect(page.locator("#download .download-track")).toHaveAttribute("role", "progressbar");

  await expect(text).toHaveText("Downloaded · works offline", { timeout: 30_000 });
  const frames = await barFrames(page);
  const shown = frames.filter((f) => f.shown);
  // The share only ever grows, frame by frame.
  const shares = shown.map((f) => PROGRESS.exec(f.text)?.[1]).filter(Boolean).map(Number);
  expect(shares).toEqual([...shares].sort((a, b) => a - b));
  // Nothing moved for it: from the frame before it came, the title and the search box sat
  // still in every frame. (Before that, a dev server paints before its styles are in.)
  const since = frames.slice(Math.max(0, frames.findIndex((f) => f.shown) - 1));
  expect(new Set(since.map((f) => f.title)).size).toBe(1);
  expect(new Set(since.map((f) => f.box)).size).toBe(1);
});

test("once it's all in, the bar says so and fades out over 5 seconds, smoothly, then goes", async ({ page }) => {
  await network(page);
  await recordBar(page);
  await open(page);
  await expect(page.locator("#download-text")).toHaveText("Downloaded · works offline", { timeout: 30_000 });
  await expect(page.locator("#download")).toBeHidden({ timeout: 8000 });
  const frames = await barFrames(page);
  const done = frames.findIndex((f) => f.text === "Downloaded · works offline");
  const fading = frames.slice(done).filter((f) => f.shown);
  const start = fading[0].t;
  const end = fading.at(-1)!.t;
  expect(end - start).toBeGreaterThan(4500); // about 5 seconds
  expect(end - start).toBeLessThan(6500);
  for (let i = 1; i < fading.length; i++) {
    expect(fading[i].opacity, "only ever fading").toBeLessThanOrEqual(fading[i - 1].opacity + 1e-6);
    expect(fading[i - 1].opacity - fading[i].opacity, "no jump between frames").toBeLessThan(0.08);
  }
  const midway = fading.find((f) => f.t - start >= 2500)!;
  expect(midway.opacity).toBeGreaterThan(0.3);
  expect(midway.opacity).toBeLessThan(0.7);
});

test("with no connection it says so and stays, then carries on once the signal's back", async ({ page }) => {
  const net = await network(page);
  net.delayMs = 1500;
  await recordBar(page);
  await open(page);
  const text = page.locator("#download-text");
  await expect(text).toHaveText(PROGRESS);
  net.down = true;
  await page.context().setOffline(true);
  await expect(text).toHaveText(/^Downloading \d+% · No connection$/, { timeout: 15_000 });
  await page.waitForTimeout(6000); // longer than the fade: it doesn't go while it isn't done
  await expect(page.locator("#download")).toBeVisible();
  net.down = false;
  net.delayMs = 300;
  await page.context().setOffline(false);
  // At once, as the browser says it's back: well before the next timed try (15 s).
  await expect(text).toHaveText("Downloaded · works offline", { timeout: 8000 });
});

test("Settings says only how it ended, not how far along it is", async ({ page }) => {
  await network(page);
  await open(page);
  await page.locator("#settings-open").click();
  const note = page.locator("#offline");
  await expect(page.locator("#download-text")).toHaveText(PROGRESS);
  await expect(note).toBeHidden(); // the bar has the progress
  await expect(note).toHaveText("Saved on this device: works offline.", { timeout: 30_000 });
  await expect(note).toBeVisible();
});

test("with the dictionary already on the device, the bar never shows", async ({ page }) => {
  await network(page);
  await open(page);
  await expect(page.locator("#download-text")).toHaveText("Downloaded · works offline", { timeout: 30_000 });
  await recordBar(page);
  await page.reload();
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await page.waitForTimeout(1500);
  expect((await barFrames(page)).filter((f) => f.shown)).toEqual([]);
});

test("the Android app downloads nothing: no bar", async ({ page }) => {
  await asTheApp(page);
  await recordBar(page);
  await open(page);
  await page.waitForTimeout(1500);
  expect((await barFrames(page)).filter((f) => f.shown)).toEqual([]);
});
