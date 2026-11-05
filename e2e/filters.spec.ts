import { test, expect, type Page, type Locator } from "@playwright/test";

// The Filters panel: a funnel button under the settings cog opens it; word
// length is set with two roller wheels (Min, Max) turned by dragging up and
// down. No keyboard pops up; arrow keys work on a focused wheel.

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
      .map((row) => row.getAttribute("aria-label")!),
  );

const chars = (word: string) => Array.from(word).length;

/** Turn a wheel by dragging: `rows` > 0 drags up, bringing later values to the middle. */
async function turn(page: Page, wheel: Locator, rows: number) {
  const box = (await wheel.boundingBox())!;
  const rowHeight = Number(await wheel.getAttribute("data-row-height"));
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - rows * rowHeight, { steps: 12 });
  await page.waitForTimeout(150); // hold still before letting go: no flick
  await page.mouse.up();
}

test("the funnel under the cog opens word-length wheels that filter the list, and are remembered", async ({ page }) => {
  await open(page);
  const funnel = page.getByRole("button", { name: "Filters" });
  await expect(funnel).toBeVisible();
  await expect(funnel).not.toHaveAttribute("data-active", "");
  await funnel.click();
  const dialog = page.getByRole("dialog", { name: "Filters" });
  await expect(dialog).toBeVisible();
  const min = dialog.getByRole("spinbutton", { name: "Minimum word length" });
  const max = dialog.getByRole("spinbutton", { name: "Maximum word length" });
  await expect(min).toHaveAttribute("aria-valuetext", "Any");
  await expect(max).toHaveAttribute("aria-valuetext", "Any");

  await turn(page, min, 4); // Any, 1, 2, 3, 4
  await expect(min).toHaveAttribute("aria-valuetext", "4");
  await expect(max).toHaveAttribute("aria-valuetext", "Any");
  await turn(page, max, 2); // Any, 4, 5: Max starts from the minimum
  await expect(max).toHaveAttribute("aria-valuetext", "5");
  await max.focus();
  await page.keyboard.press("ArrowUp");
  await expect(max).toHaveAttribute("aria-valuetext", "6");
  await expect(page.locator("#q")).not.toBeFocused(); // no keyboard
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await expect(funnel).toHaveAttribute("data-active", "");

  await page.locator("#q").fill("e");
  await expect(page.locator("#summary")).toHaveText(/ [\d,]+ in all$/);
  const words = await shown(page);
  expect(words.length).toBeGreaterThan(0);
  for (const w of words) expect(chars(w), w).toBeGreaterThanOrEqual(4);
  for (const w of words) expect(chars(w), w).toBeLessThanOrEqual(6);

  await page.reload();
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await expect(page.locator("#loader")).toHaveCount(0); // a browser shows the app once all is in
  await expect(funnel).toHaveAttribute("data-active", "");
  await funnel.click();
  await expect(min).toHaveAttribute("aria-valuetext", "4");
  await expect(max).toHaveAttribute("aria-valuetext", "6");

  // A new minimum puts Max back on Any.
  await turn(page, min, -1);
  await expect(min).toHaveAttribute("aria-valuetext", "3");
  await expect(max).toHaveAttribute("aria-valuetext", "Any");
});

test("a set filter is named under the totals, and its cross clears it", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return; // once: a reload must find what the app saved
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("dictionarius.length", "4-6");
  });
  await open(page);
  const funnel = page.getByRole("button", { name: "Filters" });
  await expect(funnel).toHaveAttribute("data-active", "");
  await page.locator("#q").fill("e");
  await expect(page.locator("#summary")).toHaveText(/ [\d,]+ in all$/);
  const filtered = Number((await page.locator("#summary").textContent())!.match(/([\d,]+) in all$/)![1].replace(/,/g, ""));

  const line = page.locator("#active-filters");
  await expect(line).toHaveText("Word length: 4–6 letters");
  const below = (await line.boundingBox())!.y >= (await page.locator("#summary").boundingBox())!.y + 1;
  expect(below).toBe(true);

  await page.getByRole("button", { name: "Clear the word length filter" }).click();
  await expect(line).toBeHidden();
  await expect(funnel).not.toHaveAttribute("data-active", "");
  await expect(page.locator("#summary")).toHaveText(/ [\d,]+ in all$/);
  const all = Number((await page.locator("#summary").textContent())!.match(/([\d,]+) in all$/)![1].replace(/,/g, ""));
  expect(all).toBeGreaterThan(filtered);
  await funnel.click(); // the wheels say Any again
  await expect(page.getByRole("spinbutton", { name: "Minimum word length" })).toHaveAttribute("aria-valuetext", "Any");
  await page.reload();
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await expect(page.locator("#loader")).toHaveCount(0); // a browser shows the app once all is in
  await expect(funnel).not.toHaveAttribute("data-active", ""); // and it stays cleared
});

test("no filter line on the start screen or while no range is set", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("e");
  await expect(page.locator("#summary")).toHaveText(/ [\d,]+ in all$/);
  await expect(page.locator("#active-filters")).toBeHidden();
});
