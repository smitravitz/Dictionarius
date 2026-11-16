import { test, expect, type Browser, type Page } from "@playwright/test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { preview } from "vite";

// Opening the published app once it's kept on the device (web/sw.js): it opens from the
// device at once, whatever the network is doing, as an installed app should; a new build
// comes down in the background, and the open page then reloads itself into it (web/update.ts),
// back at the same search or word, once the person's hands are off. With nothing kept yet (a
// first visit), it waits for the network as any page does.

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

/** A site of its own (a copy of this build, on another port), so it can be given a new build
 *  while it's served: a new service worker (a new build name) and a page that says which
 *  build it is. A browser fetches a service worker past the test's routes, so the new build
 *  has to be on the server itself. `run` gets a page that has visited once, and `deploy`. */
async function withOwnSite(browser: Browser, port: number, run: (page: Page, deploy: () => void) => Promise<void>) {
  const site = mkdtempSync(join(tmpdir(), "dictionarius-site-"));
  cpSync(resolve("build/e2e-web"), site, { recursive: true });
  const server = await preview({ configFile: false, root: site, logLevel: "silent", build: { outDir: "." }, preview: { port, strictPort: true } });
  const context = await browser.newContext({ baseURL: `http://localhost:${port}`, storageState: "e2e/tour-done.json" });
  try {
    const page = await context.newPage();
    // How many times this tab has loaded the page, and how many times it reloaded itself.
    await page.addInitScript(() => sessionStorage.setItem("loads", String(Number(sessionStorage.getItem("loads") ?? 0) + 1)));
    await visitOnce(page);
    const write = (file: string, change: (text: string) => string) =>
      writeFileSync(join(site, file), change(readFileSync(join(site, file), "utf8")));
    await run(page, () => {
      write("sw.js", (sw) => sw.replace(/const BUILD = "[0-9a-f]+"/, 'const BUILD = "0next0build0"'));
      write("index.html", (html) => html.replace("<title>Dictionarius</title>", "<title>Dictionarius (next build)</title>"));
    });
  } finally {
    await context.close();
    await new Promise<void>((done) => server.httpServer.close(() => done()));
    rmSync(site, { recursive: true, force: true });
  }
}
const loads = (page: Page) => page.evaluate(() => Number(sessionStorage.getItem("loads")));
/** The person comes back to the tab: the page asks whether there's a new build. */
const comeBackToTheTab = (page: Page) => page.evaluate(() => void document.dispatchEvent(new Event("visibilitychange")));

test("opened after a new build is published, it shows from the device at once, then turns into the new build by itself", async ({ browser }) => {
  await withOwnSite(browser, 4176, async (page, deploy) => {
    deploy();
    await page.reload({ waitUntil: "commit" });
    // Before: the old build stayed until every page of it was closed, however often it was
    // reloaded. Now the page reloads itself once the new build is down: no closing, no second go.
    await expect(page).toHaveTitle("Dictionarius (next build)", { timeout: 20_000 });
    await expect(page.locator("#status")).toHaveText("17,082 words");
    expect(await loads(page)).toBe(3); // the first visit, the reload above, and its own reload: once
    await page.waitForTimeout(2_500);
    expect(await loads(page), "it doesn't go round again").toBe(3);
    await expect(page).toHaveTitle("Dictionarius (next build)");
  });
});

test("a tab left open turns into a new build when the person comes back to it, at the same search", async ({ browser }) => {
  await withOwnSite(browser, 4177, async (page, deploy) => {
    await page.locator("#q").fill("ingot");
    await expect(page.locator('li.word[aria-label="ingot"]')).toBeVisible();
    await page.locator("#q").blur();
    deploy();
    await comeBackToTheTab(page);
    await expect(page).toHaveTitle("Dictionarius (next build)", { timeout: 20_000 });
    await expect(page.locator("#q")).toHaveValue("ingot");
    await expect(page.locator('li.word[aria-label="ingot"]')).toBeVisible();
    expect(await loads(page)).toBe(2);
  });
});

test("and at the same word, when a word's page was open", async ({ browser }) => {
  await withOwnSite(browser, 4178, async (page, deploy) => {
    await page.locator("#q").fill("ingot");
    await page.locator("#q").blur();
    await page.locator('li.word[aria-label="ingot"]').click();
    await expect(page.locator("#entry .meaning")).toHaveCount(3);
    deploy();
    await comeBackToTheTab(page);
    await expect(page).toHaveTitle("Dictionarius (next build)", { timeout: 20_000 });
    await expect(page.locator("#entry-word")).toHaveText("ingot");
    await expect(page.locator("#entry .meaning")).toHaveCount(3);
  });
});

test("while the person is typing, the new build waits for their hands to be off", async ({ browser }) => {
  await withOwnSite(browser, 4179, async (page, deploy) => {
    deploy();
    await comeBackToTheTab(page);
    // Typing for longer than the new build takes to come down: no reload under their fingers.
    const typed = "ingot ingot ingot ingot ingot ing";
    await page.locator("#q").focus();
    for (const letter of typed) {
      await page.keyboard.type(letter);
      await page.waitForTimeout(150);
    }
    await expect(page.locator("#q")).toHaveValue(typed); // not a letter lost
    expect(await page.title()).toBe("Dictionarius");
    await expect(page).toHaveTitle("Dictionarius (next build)", { timeout: 10_000 }); // once they stop
    await expect(page.locator("#q")).toHaveValue(typed);
  });
});

test("a first visit isn't reloaded: its own service worker taking charge is no new build", async ({ browser }) => {
  await withOwnSite(browser, 4180, async (page) => {
    await page.waitForTimeout(2_500);
    expect(await loads(page)).toBe(1);
  });
});

test("with nothing kept yet, a slow network is waited for, as any page's", async ({ page }) => {
  await slowPage(page, 3_000);
  const asked = Date.now();
  await page.goto(START);
  await expect(page.locator("#status")).toHaveText("17,082 words", { timeout: 15_000 });
  expect(Date.now() - asked).toBeGreaterThanOrEqual(3_000 - 200);
});
