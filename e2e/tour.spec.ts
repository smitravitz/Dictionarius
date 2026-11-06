import { test, expect, type Page } from "@playwright/test";

// The first-run tour: three things to do (search, peek, scrub), each by doing it, once.
// And the "?" beside the cog: how everything works, and the tour again.

test.use({ storageState: { cookies: [], origins: [] } }); // a first run

async function firstRun(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" }); // a still start screen, to tap reliably
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await expect(page.locator("#loader")).toHaveCount(0);
}

/** Where the ghost finger points: the person does the step right there. */
async function fingerAt(page: Page) {
  const finger = page.locator("#coach-finger");
  await expect(finger).toBeVisible();
  const box = (await finger.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const card = (page: Page) => page.locator("#coach");

test("a first run is shown three things, one at a time, by doing them", async ({ page }) => {
  await firstRun(page);
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator(".coach-count")).toHaveText("1 of 3");
  await expect(card(page).locator(".coach-text")).toContainText("Tap a piece on the start screen");
  // The note never covers what it's about: here, the pieces.
  await fingerAt(page);
  const note = (await card(page).boundingBox())!;
  const pieces = (await page.locator("#examples").boundingBox())!;
  expect(note.y + note.height).toBeLessThanOrEqual(pieces.y);

  // 1. A suggestion: the list opens.
  await page.locator("#examples button.tile").first().click();
  await expect(page.locator("#frame")).toBeVisible();
  await expect(card(page).locator(".coach-count")).toHaveText("2 of 3");
  await expect(card(page).locator(".coach-text")).toContainText("Hold a word");

  // 2. Hold a word, where the finger shows: its peek opens.
  const word = await fingerAt(page);
  await page.mouse.move(word.x, word.y);
  await page.mouse.down();
  await expect(page.locator("#peek")).toBeVisible();
  await page.mouse.up();
  await expect(card(page).locator(".coach-count")).toHaveText("3 of 3");
  await expect(card(page).locator(".coach-text")).toContainText("Hold the space beside the words");

  // 3. Hold the space beside the words, where the finger shows, and slide the way it does.
  const blank = await fingerAt(page);
  await page.mouse.move(blank.x, blank.y);
  await page.mouse.down();
  await page.waitForTimeout(600);
  for (let dx = 4; dx <= 72; dx += 4) await page.mouse.move(blank.x - dx, blank.y);
  await expect(page.locator(".slider")).toHaveClass(/\bon\b/);
  await page.mouse.up();
  await expect(card(page)).toContainText("Tap ? any time");
  await expect(card(page)).toBeHidden({ timeout: 8000 });

  // Done for good: not again on the next start.
  await page.reload();
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await expect(page.locator("#examples button.tile").first()).toBeVisible();
  await expect(card(page)).toBeHidden();
});

test("typing a search does the first step too", async ({ page }) => {
  await firstRun(page);
  await page.locator("#q").fill("ate");
  await expect(card(page).locator(".coach-count")).toHaveText("2 of 3");
});

test("Skip ends the tour for good", async ({ page }) => {
  await firstRun(page);
  await card(page).getByRole("button", { name: "Skip" }).click();
  await expect(card(page)).toBeHidden();
  await page.reload();
  await expect(page.locator("#examples button.tile").first()).toBeVisible();
  await expect(card(page)).toBeHidden();
});

test("the card never stands in the way: the list under it still takes a tap", async ({ page }) => {
  await firstRun(page);
  await page.locator("#examples button.tile").first().click();
  const box = (await card(page).boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.y + box.height).toBeLessThanOrEqual(view.height); // on screen
  expect(box.height).toBeLessThan(view.height / 3); // a note, not a wall
});

test("the ? beside the cog says how everything works, and can start the tour again", async ({ page }) => {
  await page.context().addInitScript(() => localStorage.setItem("dictionarius.tour", "done"));
  await firstRun(page);
  const help = page.locator("#help-open");
  const cog = page.locator("#settings-open");
  expect((await help.boundingBox())!.x).toBeLessThan((await cog.boundingBox())!.x); // to the left of the cog
  await expect(help).toHaveAccessibleName("How it works");
  await help.click();
  const sheet = page.locator("#help");
  await expect(sheet).toBeVisible();
  for (const how of ["Hold a word", "Hold the space beside the words, then slide sideways", "swipe left or right"]) {
    await expect(sheet).toContainText(how);
  }
  await sheet.getByRole("button", { name: "Show me again" }).click();
  await expect(sheet).toBeHidden();
  await expect(card(page).locator(".coach-count")).toHaveText("1 of 3");
});
