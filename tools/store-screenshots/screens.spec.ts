import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";

// The pictures Google Play and the App Store ask for, taken from the real app at each
// store's size (playwright.store.config.ts; one project per store). They land in
// store-screenshots/<project>/, numbered in the order the stores should show them.
//   DICTIONARIUS_SAMPLE_DATA=release-data npx playwright test --config playwright.store.config.ts
// On the fixture (the default) the same screens are taken with its made-up words, which
// is enough to check that this file still runs (CI does).

const DATA = process.env.DICTIONARIUS_SAMPLE_DATA ?? "test/fixtures";
const REAL = existsSync(`${DATA}/headwords.bin`);
const INDEX = REAL ? "headwords.bin" : "headwords-sample.bin";
const LOAD_MS = REAL ? 120_000 : 10_000; // the real list takes a while to open in a browser
test.describe.configure({ timeout: 60_000 + LOAD_MS });

// A piece that finds many words, and one of them with a full page.
const PIECE = REAL ? "eren" : "zorb";
const WORD = REAL ? "serene" : "zorble";

async function open(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" }); // a still page: no frame caught mid-move
  await page.goto(`/?index=${INDEX}`);
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/, { timeout: LOAD_MS });
  await expect(page.locator("#loader")).toHaveCount(0, { timeout: LOAD_MS });
  await page.evaluate(() => document.fonts.ready);
}

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(400); // let a dialog or a page finish arriving
  await page.screenshot({ path: `store-screenshots/${test.info().project.name}/${name}.png` });
}

async function openWord(page: Page) {
  await page.locator("#q").fill(WORD);
  await page.locator("#q").press("Enter");
  await expect(page.locator("#entry-word")).toHaveText(WORD);
  await expect(page.locator("#entry .meaning").first()).toBeVisible();
}

test("1: the start screen", async ({ page }) => {
  await open(page);
  await shoot(page, "1-start");
});

test("2: a piece of a word finds every word that has it", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill(PIECE);
  await expect(page.locator("li.word").first()).toBeVisible();
  await expect(page.locator("#summary")).not.toHaveText("");
  await shoot(page, "2-search");
});

test("3: a word's page", async ({ page }) => {
  await open(page);
  await openWord(page);
  await shoot(page, "3-word");
});

test("4: filters", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill(PIECE);
  await expect(page.locator("li.word").first()).toBeVisible();
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
  await shoot(page, "4-filters");
});

test("5: a word's page in light mode", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Done" }).click();
  await openWord(page);
  await shoot(page, "5-light");
});
