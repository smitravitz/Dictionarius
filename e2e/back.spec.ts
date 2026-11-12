import { test, expect, type Page } from "@playwright/test";
import { asInstalled, asTheApp } from "./as-the-app";

// Back, in each way Dictionarius runs. An app (the Android app, or the web app installed from
// the browser) is a place of its own: Back goes from a word to the results, from the results
// to the start screen, and from there out of the app. Android's own Back steps through the
// page's history while it can (web/native.ts); an installed web app's Back simply is the
// history's, so both are tested through the history here.
// A page in a browser tab is the browser's: Back from a word goes to the results, and from
// the results it leaves the page, as pages do.
// Either way Back never does nothing: going somewhere by hand (clearing the box, typing a new
// search on a word's page) takes the steps it left out of the history, so the next Back goes
// on from where the person is.

async function open(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await expect(page.locator("#loader")).toHaveCount(0);
}

async function search(page: Page, text: string) {
  await page.locator("#q").fill(text);
  await page.locator("#q").blur();
  await expect(page.locator("#frame")).toBeVisible();
  await expect(page.locator("#scroller li.word:not(.pending)").first()).toBeVisible();
}

async function openWord(page: Page, word: string) {
  await page.locator(`li.word[aria-label="${word}"]`).click();
  await expect(page.locator("#entry-word")).toHaveText(word);
}

async function onResults(page: Page, query: string) {
  await expect(page.locator("#entry")).toBeHidden();
  await expect(page.locator("#frame")).toBeVisible();
  await expect(page.locator("#q")).toHaveValue(query);
}

async function onStartScreen(page: Page) {
  await expect(page.locator("#intro")).toBeVisible();
  await expect(page.locator("#frame")).toBeHidden();
  await expect(page.locator("#entry")).toBeHidden();
  await expect(page.locator("#q")).toHaveValue("");
}

/** Back takes the person out: the page before it (here a blank one; in a real app, none,
 *  so the app closes). */
async function backLeaves(page: Page) {
  await page.goBack();
  await expect(page).toHaveURL("about:blank");
}

/** Empty the search box by hand, as a person deleting what they typed. */
async function clearByHand(page: Page) {
  await page.locator("#q").focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
}

async function swipeBack(page: Page) {
  const { width, height } = page.viewportSize()!;
  const cdp = await page.context().newCDPSession(page);
  const y = Math.round(height * 0.6);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: Math.round(width * 0.25), y }] });
  for (let i = 1; i <= 5; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.round(width * (0.25 + 0.1 * i)), y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

const apps = [
  { name: "installed from the browser", as: asInstalled },
  { name: "the Android app", as: asTheApp },
];

for (const app of apps) {
  test.describe(`as an app (${app.name})`, () => {
    test.beforeEach(async ({ page }) => {
      await app.as(page);
      await open(page);
    });

    test("Back goes from a word to the results, to the start screen, then out of the app", async ({ page }) => {
      await search(page, "ingot");
      await openWord(page, "ingot");
      await page.goBack();
      await onResults(page, "ingot");
      await page.goBack();
      await onStartScreen(page);
      await backLeaves(page);
    });

    test("on the start screen there is nothing to go back to: Back leaves at once", async ({ page }) => {
      await backLeaves(page);
    });

    test("a suggestion's list is a step too", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" }); // the pieces hold still to be tapped
      await page.locator("#examples button[data-query='ing']").first().click();
      await expect(page.locator("#frame")).toBeVisible();
      await expect(page.locator("#q")).toHaveValue("ing");
      await page.goBack();
      await onStartScreen(page);
      await backLeaves(page);
    });

    test("words followed from a word are one step, as before", async ({ page }) => {
      await search(page, "zorbles");
      await openWord(page, "zorbles");
      await page.locator("#entry").getByRole("button", { name: "zorble" }).click();
      await expect(page.locator("#entry-word")).toHaveText("zorble");
      await page.goBack();
      await onResults(page, "zorbles");
      await page.goBack();
      await onStartScreen(page);
    });

    test("emptying the box by hand leaves no step behind: the next Back leaves", async ({ page }) => {
      await search(page, "ingot");
      await openWord(page, "ingot");
      await clearByHand(page);
      await onStartScreen(page);
      await backLeaves(page);
    });

    test("a new search typed on a word's page: Back goes to the start screen, not to the old word", async ({ page }) => {
      await search(page, "ingot");
      await openWord(page, "ingot");
      await search(page, "zorb");
      await page.goBack();
      await onStartScreen(page);
      await backLeaves(page);
    });

    test("Forward after Back to the start screen brings the search back", async ({ page }) => {
      await search(page, "ingot");
      await page.goBack();
      await onStartScreen(page);
      await page.goForward();
      await onResults(page, "ingot");
      await expect(page.locator('li.word[aria-label="ingot"]')).toBeVisible();
      await page.goBack();
      await onStartScreen(page);
    });

    test("a swipe back from the first word goes to the results, and Back from there to the start screen", async ({ page, isMobile }) => {
      test.skip(!isMobile, "touch swipes on the phone project");
      await search(page, "ingot");
      await openWord(page, "ingot");
      await swipeBack(page);
      await onResults(page, "ingot");
      await page.goBack();
      await onStartScreen(page);
    });
  });
}

test.describe("in a browser tab", () => {
  test.beforeEach(async ({ page }) => open(page));

  test("Back from a word goes to the results; from the results it leaves the page, as pages do", async ({ page }) => {
    await search(page, "ingot");
    await openWord(page, "ingot");
    await page.goBack();
    await onResults(page, "ingot");
    await backLeaves(page);
  });

  test("after a new search typed on a word's page, Back leaves the page at once (no Back that does nothing)", async ({
    page,
  }) => {
    await search(page, "ingot");
    await openWord(page, "ingot");
    await search(page, "zorb");
    await backLeaves(page);
  });

  test("after going home from a word's page, Back leaves the page at once", async ({ page }) => {
    await search(page, "ingot");
    await openWord(page, "ingot");
    await clearByHand(page);
    await onStartScreen(page);
    await backLeaves(page);
  });
});
