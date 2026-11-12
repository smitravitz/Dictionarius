import { test, expect, type Page } from "@playwright/test";
import { asInstalled, asTheApp } from "./as-the-app";

/** Open the app on the fixture index and wait until it has loaded. */
async function open(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await expect(page.locator("#loader")).toHaveCount(0); // a browser shows the app once all is in
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
  await expect(page.locator("#loader")).toHaveCount(0); // a browser shows the app once all is in
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
  await expect(page.locator("#summary")).toHaveText("Settings or filters hide every word with “rudeword”.");
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

test("says so when safe search or a filter hides every match", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("slurw");
  await expect(page.locator("#summary")).toHaveText("Settings or filters hide every word with “slurw”.");
  await expect(page.locator("li.word")).toHaveCount(0);
});

// The fixture's made-up names: Zorbleton and Quillmarch (proper nouns);
// "turkeyword" (a bird) is more common than "Turkeyword" (a country), so it stays.

test("only common words by default: phrases and names start hidden, and come back when switched off", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByRole("switch", { name: /Disable phrases/ })).toBeChecked();
  await expect(dialog.getByRole("switch", { name: /Disable names/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Done" }).click();

  await page.locator("#q").fill("zorble");
  await expect(page.locator("#summary")).toHaveText(/in all$/);
  expect(await shown(page)).toEqual(["zorble", "zorbles"]);
  await page.locator("#q").fill("air");
  await expect(page.locator("#summary")).toHaveText(/in all$/);
  expect((await shown(page)).filter((w) => w!.includes(" "))).toEqual([]);

  await page.getByRole("button", { name: "Settings" }).click();
  await dialog.getByRole("switch", { name: /Disable phrases/ }).uncheck();
  await dialog.getByRole("switch", { name: /Disable names/ }).uncheck();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect.poll(() => shown(page)).toContain("air gap");
  await page.locator("#q").fill("zorble");
  await expect.poll(() => shown(page)).toEqual(["zorble", "zorbles", "Zorbleton"]);

  await page.reload();
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await expect(page.locator("#loader")).toHaveCount(0); // a browser shows the app once all is in
  await page.locator("#q").fill("zorble");
  await expect.poll(() => shown(page)).toEqual(["zorble", "zorbles", "Zorbleton"]); // still off after a reload
});

// Every setting is remembered: kept on the device as it's changed, and there again on the next
// start, in a browser tab and in each app.
const shells = [
  { name: "a browser tab", as: async (_page: Page) => {} },
  { name: "the web app installed", as: asInstalled },
  { name: "the Android app", as: asTheApp },
];

/** Each switch in Settings: its name and whether it's on. */
const switchStates = (page: Page) =>
  page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("switch")
    .evaluateAll((switches) =>
      switches.map((el) => [
        el.getAttribute("aria-label") ?? el.closest("label")?.querySelector(".setting-name")?.textContent ?? "",
        el.getAttribute("aria-checked") ?? String((el as HTMLInputElement).checked),
      ]),
    );

for (const shell of shells) {
  test(`every setting is there again on the next start (${shell.name})`, async ({ page, context }) => {
    await shell.as(page);
    await open(page);
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    const before = await switchStates(page);
    expect(before.length).toBeGreaterThanOrEqual(4); // the filters, the navigation buttons, dark mode
    for (let i = 0; i < before.length; i++) await dialog.getByRole("switch").nth(i).click(); // each from its default
    const set = await switchStates(page);
    expect(set.map(([, on]) => on)).toEqual(before.map(([, on]) => (on === "true" ? "false" : "true")));

    // Closed, then started again on the same device.
    const next = await context.newPage();
    await page.close();
    await shell.as(next);
    await open(next);
    await next.getByRole("button", { name: "Settings" }).click();
    expect(await switchStates(next)).toEqual(set);
  });
}

test("the installed app asks the browser to keep its storage for good; a tab and the Android app don't need to", async ({ browser }) => {
  for (const shell of shells) {
    const context = await browser.newContext({ storageState: "e2e/tour-done.json" });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const asked = { count: 0 };
      (window as unknown as { persistAsked: typeof asked }).persistAsked = asked;
      Object.defineProperty(navigator.storage, "persist", {
        value: async () => {
          asked.count++;
          return true;
        },
      });
    });
    await shell.as(page);
    await open(page);
    const asked = await page.evaluate(() => (window as unknown as { persistAsked: { count: number } }).persistAsked.count);
    expect(asked, shell.name).toBe(shell.as === asInstalled ? 1 : 0);
    await context.close();
  }
});
