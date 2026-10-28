import { test, expect, type Page } from "@playwright/test";

/** Open the app on the fixture index and wait until it has loaded. */
async function open(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
}

test("with the keyboard open, a tap on a word only closes the keyboard", async ({ page, isMobile }) => {
  test.skip(!isMobile, "a touch screen's keyboard");
  await open(page);
  const input = page.locator("#q");
  await input.fill("ate"); // typing: the search box has focus, so the keyboard is up
  await expect(input).toBeFocused();
  const word = page.locator("li.word").nth(2);
  await expect(word).toBeVisible();

  await word.tap();
  await expect(input).not.toBeFocused(); // the keyboard went away…
  await expect(page.locator("#entry")).toBeHidden(); // …and no word opened
  await expect(page.locator("#results")).toBeVisible();

  await word.tap(); // with the keyboard closed, a tap opens the word
  await expect(page.locator("#entry")).toBeVisible();
});

test("a mouse click on a word opens it, even while typing", async ({ page, isMobile }) => {
  test.skip(isMobile, "a mouse");
  await open(page);
  await page.locator("#q").fill("ate");
  await expect(page.locator("#q")).toBeFocused();
  await page.locator("li.word").nth(2).click();
  await expect(page.locator("#entry")).toBeVisible();
});
