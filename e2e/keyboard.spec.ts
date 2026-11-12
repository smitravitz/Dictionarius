import { test, expect, type Page } from "@playwright/test";
import { asTheApp } from "./as-the-app";

/** Open the app on the fixture index and wait until it has loaded. */
async function open(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await expect(page.locator("#loader")).toHaveCount(0); // a browser shows the app once all is in
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

// Enter pressed before its results are on screen isn't lost: it's done once they are, for
// that search. The Android app searches only once its word list is in, so holding the list
// back holds the results.
async function holdWordList(page: Page) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route((url) => url.pathname.endsWith("/headwords-sample.bin"), async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  return release;
}

test("Enter pressed before the results are in opens the first word once they are", async ({ page }) => {
  await asTheApp(page);
  const release = await holdWordList(page);
  await page.goto("/?index=headwords-sample.bin");
  await page.locator("#q").fill("ingot");
  await page.locator("#q").press("Enter");
  await expect(page.locator("#entry")).toBeHidden(); // nothing to open yet
  release();
  await expect(page.locator("#entry-word")).toHaveText("ingot");
  await expect(page.locator("#q")).not.toBeFocused(); // its page is for reading: the keyboard goes
});

test("an early Enter is dropped if the search changes before its results come", async ({ page }) => {
  await asTheApp(page);
  const release = await holdWordList(page);
  await page.goto("/?index=headwords-sample.bin");
  await page.locator("#q").fill("ingo");
  await page.locator("#q").press("Enter");
  await page.locator("#q").press("t"); // typed on: the Enter was for "ingo"
  release();
  await expect(page.locator("li.word").first()).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator("#entry")).toBeHidden();
  await expect(page.locator("#q")).toBeFocused();
});

/** The search box's selection: [start, end], and its text's length. */
const selection = (page: Page) =>
  page.locator("#q").evaluate((q: HTMLInputElement) => ({ start: q.selectionStart, end: q.selectionEnd, length: q.value.length }));

test("coming back to the search box selects its text, so typing replaces it", async ({ page, isMobile }) => {
  await open(page);
  const input = page.locator("#q");
  await input.fill("ingot");
  await page.locator("#status").click(); // off the box
  await expect(input).not.toBeFocused();
  if (isMobile) await input.tap();
  else await input.click();
  await expect(input).toBeFocused();
  expect(await selection(page)).toEqual({ start: 0, end: 5, length: 5 });
  await page.keyboard.type("ate");
  await expect(input).toHaveValue("ate");
});

test("a click inside the box while typing places the cursor, as usual: it doesn't select it all", async ({ page, isMobile }) => {
  test.skip(isMobile, "a mouse");
  await open(page);
  const input = page.locator("#q");
  await input.fill("ingot");
  const box = (await input.boundingBox())!;
  await page.mouse.click(box.x + 12, box.y + box.height / 2); // near the start of the text
  const { start, end } = await selection(page);
  expect(start).toBe(end); // a cursor, not a selection
});

test("tapping off the search box drops its selection, and the keyboard goes", async ({ page, isMobile }) => {
  await open(page);
  const input = page.locator("#q");
  await input.fill("ingot");
  await input.evaluate((q: HTMLInputElement) => q.select());
  if (isMobile) await page.locator("#status").tap();
  else await page.locator("#status").click();
  await expect(input).not.toBeFocused();
  const { start, end } = await selection(page);
  expect(start).toBe(end);
  await expect(input).toHaveValue("ingot"); // the text stays
});
