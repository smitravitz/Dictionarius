import { test, expect, type Page } from "@playwright/test";

/** Open the app on the fixture index and wait until it has loaded. */
async function open(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
}

/** Words shown in the list (rendered rows), in order. */
const shown = (page: Page) =>
  page.locator("li.word").evaluateAll((rows) =>
    rows
      .sort((a, b) => Number(a.getAttribute("aria-posinset")) - Number(b.getAttribute("aria-posinset")))
      .map((row) => row.getAttribute("aria-label")),
  );

// The fixture's made-up labelled words: rudeword, rudewords and rudewurd are
// explicit (vulgar, and its plural and spelling). mixedword and gapword have
// an ordinary main meaning, so they stay: labels further down hide nothing.

test("the cog opens settings, with safe search on by default", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("switch", { name: /Safe search/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("safe search hides explicit words; turning it off shows them, and is remembered", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("rude");
  await expect(page.locator("#summary")).toHaveText(/in all$/);
  let words = await shown(page);
  expect(words).not.toContain("rudeword");
  expect(words).not.toContain("rudewords");

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("switch", { name: /Safe search/ }).uncheck();
  await page.getByRole("button", { name: "Done" }).click();
  await expect.poll(() => shown(page)).toContain("rudeword");
  words = await shown(page);
  expect(words).toContain("rudewords");

  await page.reload();
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await page.locator("#q").fill("rude");
  await expect.poll(() => shown(page)).toContain("rudeword"); // still off after a reload
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("switch", { name: /Safe search/ })).not.toBeChecked();
  await page.getByRole("switch", { name: /Safe search/ }).check();
  await page.keyboard.press("Escape");
  await expect.poll(() => shown(page)).not.toContain("rudeword");
});

test("safe search hides a word even when it is typed out in full", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("rudeword");
  await expect(page.locator("#summary")).toHaveText(/^Safe search hides every word with “rudeword”/);
  expect(await shown(page)).toEqual([]);
});

test("words with an ordinary meaning too are not hidden", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("mixed");
  await expect.poll(() => shown(page)).toContain("mixedword");
});

test("labels further down a word's meanings don't hide it", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("gap");
  await expect.poll(() => shown(page)).toContain("gapword");
  await page.locator("#q").fill("hedge");
  await expect.poll(() => shown(page)).toEqual(["hedge", "hedger", "hedgeword"]);
});

test("says so when safe search hides every match", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("slurw");
  await expect(page.locator("#summary")).toHaveText("Safe search hides every word with “slurw”. You can turn it off in Settings.");
  await expect(page.locator("li.word")).toHaveCount(0);
});
