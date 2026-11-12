import { test, expect, type Page } from "@playwright/test";
import { asInstalled, asTheApp } from "./as-the-app";

// A phone closes apps in the background when memory runs short, and they then start from
// nothing: Android kills the Android app, and the web app installed from the browser alike.
// An app keeps where the person was as it goes to the background, and comes back there:
// the search, how far down, the word open. A new page on the same device stands in for the
// kill: the old one goes, with its history; storage stays. A page in a browser tab is a page:
// reloaded, it starts fresh.

/** Each app, run as itself in every page it opens. */
const apps = [
  { name: "the Android app", as: asTheApp },
  { name: "installed from the browser", as: asInstalled },
];
type RunAs = (page: Page) => Promise<void>;

async function openApp(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
}

/** The app going to the background (the person switched away), as Android tells the page. */
async function toBackground(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** Killed in the background, then opened again: a fresh page, the device's storage kept.
 *  `watch` runs on the fresh page before it opens (to record its frames, say). */
async function killAndReopen(page: Page, runAs: RunAs, watch?: (page: Page) => Promise<void>): Promise<Page> {
  const context = page.context();
  await page.close();
  const fresh = await context.newPage();
  await runAs(fresh); // still the app
  await watch?.(fresh);
  await fresh.goto("/?index=headwords-sample.bin");
  await expect(fresh.locator("#status")).toHaveText(/^[\d,]+ words$/);
  return fresh;
}

/** Killed with no warning at all: the page's process just ends (as Android's low-memory
 *  killer ends an app), so it hears nothing, not even that it's being hidden. */
async function killHardAndReopen(page: Page, runAs: RunAs): Promise<Page> {
  const context = page.context();
  const fresh = await context.newPage(); // opened first: the device carries on without the old page
  const cdp = await context.newCDPSession(page);
  void cdp.send("Page.crash").catch(() => {}); // never answers: the page is gone
  await page.waitForEvent("crash");
  await page.close().catch(() => {});
  await runAs(fresh);
  await fresh.goto("/?index=headwords-sample.bin");
  await expect(fresh.locator("#status")).toHaveText(/^[\d,]+ words$/);
  return fresh;
}

/** Which screen each painted frame shows, from the very first: the loading screen, the
 *  start screen, the list or a word's page. Read back with screensSeen(). */
async function recordScreens(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { screens: string[] }).screens = seen;
    const shown = (id: string) => {
      const el = document.getElementById(id);
      return !!el && !el.hidden && el.getClientRects().length > 0;
    };
    const look = () => {
      const loader = document.getElementById("loader");
      const screen = loader && !loader.classList.contains("gone") ? "loading" : shown("entry") ? "word" : shown("frame") ? "list" : shown("intro") ? "start" : "nothing";
      if (seen.at(-1) !== screen) seen.push(screen);
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}
const screensSeen = (page: Page) => page.evaluate(() => (window as unknown as { screens: string[] }).screens);

async function searchFor(page: Page, text: string) {
  await page.locator("#q").fill(text);
  await page.locator("#q").blur();
  await expect(page.locator("#scroller li.word:not(.pending)").first()).toBeVisible();
}

for (const shell of apps) {
  test.describe(`as an app (${shell.name})`, () => {
    test("it comes back to the search, and how far down it was, after being killed", async ({ page }) => {
      await shell.as(page);
      await openApp(page);
      await searchFor(page, "ate");
      await page.locator("#scroller").evaluate((el) => (el.scrollTop = 1500));
      await expect.poll(() => page.locator("#scroller li.word:not(.pending)").count()).toBeGreaterThan(5);
      const top = await page.locator("#scroller").evaluate((el) => el.scrollTop);
      await toBackground(page);

      const app = await killAndReopen(page, shell.as);
      await expect(app.locator("#frame")).toBeVisible();
      await expect(app.locator("#q")).toHaveValue("ate");
      await expect.poll(() => app.locator("#scroller").evaluate((el) => el.scrollTop)).toBe(top);
    });

    test("and to the word that was open", async ({ page }) => {
      await shell.as(page);
      await openApp(page);
      await searchFor(page, "ingot");
      await page.locator('li.word[aria-label="ingot"]').click();
      await expect(page.locator("#entry-word")).toHaveText("ingot");
      await toBackground(page);

      const app = await killAndReopen(page, shell.as);
      await expect(app.locator("#entry")).toBeVisible();
      await expect(app.locator("#entry-word")).toHaveText("ingot");
      await app.goBack(); // Back still goes to the list
      await expect(app.locator("#frame")).toBeVisible();
      await expect(app.locator("#q")).toHaveValue("ingot");
      await app.goBack(); // and from there to the start screen, as on any start
      await expect(app.locator("#intro")).toBeVisible();
      await expect(app.locator("#q")).toHaveValue("");
    });

    test("it comes back straight to the word: its page is the first screen shown, and Back finds the list as far down as it was", async ({
      page,
    }) => {
      await shell.as(page);
      await openApp(page);
      await searchFor(page, "ate");
      await page.locator("#scroller").evaluate((el) => (el.scrollTop = 1500));
      await expect.poll(() => page.locator("#scroller li.word:not(.pending)").count()).toBeGreaterThan(5);
      const top = await page.locator("#scroller").evaluate((el) => el.scrollTop);
      // A word in view (the list draws a few rows above and below it too): the third one.
      const word = await page.locator("#scroller").evaluate((scroller) => {
        const view = scroller.getBoundingClientRect();
        const inView = [...scroller.querySelectorAll<HTMLElement>("li.word:not(.pending)")]
          .filter((row) => row.getBoundingClientRect().top >= view.top && row.getBoundingClientRect().bottom <= view.bottom)
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        return inView[2].getAttribute("aria-label")!;
      });
      await page.locator(`li.word[aria-label="${word}"]`).click();
      await expect(page.locator("#entry-word")).toHaveText(word);
      await toBackground(page);
      expect(JSON.parse((await page.evaluate(() => localStorage.getItem("dictionarius.place")))!)).toMatchObject({ query: "ate", scrollTop: top, word });

      const app = await killAndReopen(page, shell.as, recordScreens);
      await expect(app.locator("#entry-word")).toHaveText(word);
      await expect(app.locator("#entry-note")).not.toHaveText(/^Still/); // its page as it is, not on its way
      // Every frame on the way showed the start (loading or start screen) or the word's page:
      // never the list first, nor nothing at all.
      const seen = await screensSeen(app);
      expect(seen.filter((screen) => screen === "list" || screen === "nothing")).toStrictEqual([]);
      expect(seen.at(-1)).toBe("word");
      await app.goBack();
      await expect(app.locator("#frame")).toBeVisible();
      await expect(app.locator("#q")).toHaveValue("ate");
      await expect.poll(() => app.locator("#scroller").evaluate((el) => el.scrollTop)).toBe(top);
      await expect(app.locator(`li.word[aria-label="${word}"]`)).toBeInViewport();
    });

    test("killed without warning (no sign it went to the background), it still comes back", async ({ page }) => {
      // On a phone the page may never hear it was hidden before Android kills it (a WebView
      // doesn't always say), so the place is kept as it changes, not only on the way out.
      await shell.as(page);
      await openApp(page);
      await searchFor(page, "ate");
      await page.locator("#scroller").evaluate((el) => (el.scrollTop = 900));
      await expect.poll(() => page.locator("#scroller li.word:not(.pending)").count()).toBeGreaterThan(5);
      const top = await page.locator("#scroller").evaluate((el) => el.scrollTop);
      await page.waitForTimeout(800); // settled

      let app = await killHardAndReopen(page, shell.as);
      await expect(app.locator("#q")).toHaveValue("ate");
      await expect.poll(() => app.locator("#scroller").evaluate((el) => el.scrollTop)).toBe(top);

      await searchFor(app, "ingot");
      await app.locator('li.word[aria-label="ingot"]').click();
      await expect(app.locator("#entry-word")).toHaveText("ingot");
      await app.waitForTimeout(800);
      app = await killHardAndReopen(app, shell.as);
      await expect(app.locator("#entry-word")).toHaveText("ingot");
    });

    test("after half an hour away, or from the start screen, it starts fresh", async ({ page }) => {
      await shell.as(page);
      await openApp(page);
      // From the start screen: nothing to come back to.
      await toBackground(page);
      await page.reload();
      await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
      await expect(page.locator("#intro")).toBeVisible();
      // A place kept more than half an hour ago: too old.
      await page.evaluate(() =>
        localStorage.setItem("dictionarius.place", JSON.stringify({ at: Date.now() - 31 * 60_000, query: "ate", scrollTop: 0, word: null })),
      );
      await page.reload();
      await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
      await page.waitForTimeout(500);
      await expect(page.locator("#intro")).toBeVisible();
      await expect(page.locator("#q")).toHaveValue("");
    });
  });
}

test("a web page that's reloaded starts fresh, as pages do", async ({ page }) => {
  await openApp(page);
  await searchFor(page, "ate");
  await toBackground(page);
  await page.reload();
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await page.waitForTimeout(500);
  await expect(page.locator("#intro")).toBeVisible();
  await expect(page.locator("#q")).toHaveValue("");
});
