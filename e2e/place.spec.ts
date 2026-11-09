import { test, expect, type Page } from "@playwright/test";
import { asTheApp } from "./as-the-app";

// Android kills an app in the background when memory runs short, and it then starts from
// nothing. The app keeps where the person was as it goes to the background, and comes back
// there: the search, how far down, the word open. A new page on the same device stands
// in for the kill: the old one goes, with its history; storage stays.

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

/** Killed in the background, then opened again: a fresh page, the device's storage kept. */
async function killAndReopen(page: Page): Promise<Page> {
  const context = page.context();
  await page.close();
  const fresh = await context.newPage();
  await asTheApp(fresh); // still the app
  await fresh.goto("/?index=headwords-sample.bin");
  await expect(fresh.locator("#status")).toHaveText(/^[\d,]+ words$/);
  return fresh;
}

async function searchFor(page: Page, text: string) {
  await page.locator("#q").fill(text);
  await page.locator("#q").blur();
  await expect(page.locator("#scroller li.word:not(.pending)").first()).toBeVisible();
}

test("the app comes back to the search, and how far down it was, after being killed", async ({ page }) => {
  await asTheApp(page);
  await openApp(page);
  await searchFor(page, "ate");
  await page.locator("#scroller").evaluate((el) => (el.scrollTop = 1500));
  await expect.poll(() => page.locator("#scroller li.word:not(.pending)").count()).toBeGreaterThan(5);
  const top = await page.locator("#scroller").evaluate((el) => el.scrollTop);
  await toBackground(page);

  const app = await killAndReopen(page);
  await expect(app.locator("#frame")).toBeVisible();
  await expect(app.locator("#q")).toHaveValue("ate");
  await expect.poll(() => app.locator("#scroller").evaluate((el) => el.scrollTop)).toBe(top);
});

test("and to the word that was open", async ({ page }) => {
  await asTheApp(page);
  await openApp(page);
  await searchFor(page, "ingot");
  await page.locator('li.word[aria-label="ingot"]').click();
  await expect(page.locator("#entry-word")).toHaveText("ingot");
  await toBackground(page);

  const app = await killAndReopen(page);
  await expect(app.locator("#entry")).toBeVisible();
  await expect(app.locator("#entry-word")).toHaveText("ingot");
  await app.goBack(); // Back still goes to the list
  await expect(app.locator("#frame")).toBeVisible();
  await expect(app.locator("#q")).toHaveValue("ingot");
});

test("after half an hour away, or from the start screen, it starts fresh", async ({ page }) => {
  await asTheApp(page);
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
