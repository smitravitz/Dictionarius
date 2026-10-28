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
// explicit (vulgar, and its plural and spelling); mixedword also has an
// ordinary meaning, so it stays.

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

test("a word typed out in full still shows with safe search on", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("rudeword");
  await expect.poll(() => shown(page)).toEqual(["rudeword"]);
  await expect(page.locator("#summary")).toHaveText(/^1 starts with “rudeword” · 1 ends with it · 1 in all$/);
});

test("words with an ordinary meaning too are not hidden", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("mixed");
  await expect.poll(() => shown(page)).toContain("mixedword");
});

test("says so when safe search hides every match", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("slurw");
  await expect(page.locator("#summary")).toHaveText("Safe search hides every word with “slurw”. You can turn it off in Settings.");
  await expect(page.locator("li.word")).toHaveCount(0);
});
