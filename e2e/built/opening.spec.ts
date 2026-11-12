import { test, expect, type Page } from "@playwright/test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { preview } from "vite";

// Opening the published app once it's kept on the device (web/sw.js): it opens from the
// device at once, whatever the network is doing, as an installed app should; a new build
// comes down in the background and is what opens from the next start, once the old one is
// closed. With nothing kept yet (a first visit), it waits for the network as any page does.

const START = "/?index=headwords-sample.bin";
const isPage = (url: URL) => url.pathname === "/" && url.search === new URL(START, "http://x").search;

/** The time (Date.now()) of the first frame that shows the page itself: its loading screen
 *  or the app. Recorded in the page from its very first frame. */
async function noteFirstFrame(page: Page) {
  await page.addInitScript(() => {
    const look = () => {
      if (document.getElementById("loader") || document.getElementById("app")) {
        (window as unknown as { firstFrame: number }).firstFrame = Date.now();
      } else requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}
const firstFrame = (page: Page) => page.evaluate(() => (window as unknown as { firstFrame: number }).firstFrame);

async function visitOnce(page: Page) {
  await page.goto(START);
  await expect(page.locator("#status")).toHaveText("17,082 words");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready; // kept, and in charge of the next start
  });
}

/** From now on the network answers for the page itself (its HTML) only after `ms`. */
async function slowPage(page: Page, ms: number) {
  await page.context().route(isPage, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue().catch(() => {}); // the page may be long gone by then
  });
}

test("once kept, it opens from the device at once, however slow the network", async ({ page }) => {
  await visitOnce(page);
  await slowPage(page, 30_000);
  await noteFirstFrame(page);
  const asked = Date.now();
  await page.reload({ waitUntil: "commit" });
  await expect(page.locator("#status")).toHaveText("17,082 words");
  // Nothing waited for the network: the first frame came in about the time a device takes.
  expect((await firstFrame(page)) - asked).toBeLessThan(1_000);
});

test("a new build comes down in the background, and opens from the next start", async ({ browser }) => {
  // A site of its own (a copy of this build, on another port), so it can be given a new
  // build while it's served: a new service worker (a new build name) and a page that says
  // which build it is. A browser fetches a service worker past the test's routes, so the new
  // build has to be on the server itself.
  const site = mkdtempSync(join(tmpdir(), "dictionarius-site-"));
  cpSync(resolve("build/e2e-web"), site, { recursive: true });
  const server = await preview({ configFile: false, root: site, logLevel: "silent", build: { outDir: "." }, preview: { port: 4176, strictPort: true } });
  const context = await browser.newContext({ baseURL: "http://localhost:4176", storageState: "e2e/tour-done.json" });
  try {
    const page = await context.newPage();
    await visitOnce(page);
    const write = (file: string, change: (text: string) => string) =>
      writeFileSync(join(site, file), change(readFileSync(join(site, file), "utf8")));
    write("sw.js", (sw) => sw.replace(/const BUILD = "[0-9a-f]+"/, 'const BUILD = "0next0build0"'));
    write("index.html", (html) => html.replace("<title>Dictionarius</title>", "<title>Dictionarius (next build)</title>"));

    // Opened again: the build kept on the device, at once; the new one comes down meanwhile,
    // and waits while a page of the old one is open.
    await page.reload();
    await expect(page).toHaveTitle("Dictionarius");
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? "none"), { timeout: 15_000 })
      .toBe("installed");
    await expect(page.locator("#status")).toHaveText("17,082 words"); // the open page goes on as it was

    // Closed, then opened from the next start: the new build.
    await page.close();
    const next = await context.newPage();
    await next.goto(START);
    await expect(next).toHaveTitle("Dictionarius (next build)");
    await expect(next.locator("#status")).toHaveText("17,082 words");
  } finally {
    await context.close();
    await new Promise<void>((done) => server.httpServer.close(() => done()));
    rmSync(site, { recursive: true, force: true });
  }
});

test("with nothing kept yet, a slow network is waited for, as any page's", async ({ page }) => {
  await slowPage(page, 3_000);
  const asked = Date.now();
  await page.goto(START);
  await expect(page.locator("#status")).toHaveText("17,082 words", { timeout: 15_000 });
  expect(Date.now() - asked).toBeGreaterThanOrEqual(3_000 - 200);
});
