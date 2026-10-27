import { test, expect, type Page } from "@playwright/test";

const ROW = 52; // ROW_HEIGHT in web/results-list.ts
const PAGE = 50; // PAGE_SIZE in web/protocol.ts

/** Open the app on the fixture index and wait until it has loaded. */
async function open(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
}

/** How many results the list holds (rendered or not): its height in rows, minus the footer. */
const loadedRows = (page: Page) =>
  page.locator("#results").evaluate((el) => Math.round(el.getBoundingClientRect().height / 52) - 1);

const scroller = (page: Page) => page.locator("#scroller");

test("shows how many words are loaded", async ({ page }) => {
  await open(page);
  await expect(page.locator("#status")).toHaveText("17,067 words");
});

test("typing shows the first 50 results, exact match first", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("e");
  await expect(page.locator("#q")).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => loadedRows(page)).toBe(PAGE);
  await expect(page.locator("#opt-0")).toHaveText("e");
  await expect(page.locator("li.word[role=option]").first()).toHaveAttribute("aria-posinset", "1");
});

test("scrolling near the end loads the next 50, again and again", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("e");
  await expect.poll(() => loadedRows(page)).toBe(PAGE);
  for (const expected of [2 * PAGE, 3 * PAGE]) {
    await scroller(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect.poll(() => loadedRows(page)).toBe(expected);
  }
  // Only rows near the viewport exist in the page, however many are loaded.
  expect(await page.locator("li.word").count()).toBeLessThan(40);
});

test("a touch drag scrolls the list and lazily loads more", async ({ page, isMobile }) => {
  test.skip(!isMobile, "touch gesture on the phone project");
  await open(page);
  await page.locator("#q").fill("e");
  await expect.poll(() => loadedRows(page)).toBe(PAGE);
  const box = (await scroller(page).boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  // Real touch events, as a phone sends them: finger down, drag up, lift.
  // The browser's own touch scrolling (with momentum) does the rest.
  const x = Math.round(box.x + box.width / 2);
  for (let drag = 0; drag < 4; drag++) {
    let y = Math.round(box.y + box.height * 0.85);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let step = 0; step < 12; step++) {
      y -= Math.round((box.height * 0.6) / 12);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await expect.poll(() => scroller(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(5 * ROW);
  await expect.poll(() => loadedRows(page)).toBeGreaterThan(PAGE);
  await expect(page.locator("#entry")).toBeHidden(); // dragging didn't open a word
});

test("a mouse drag scrolls the list without opening a word", async ({ page, isMobile }) => {
  test.skip(isMobile, "mouse drag on the desktop project");
  await open(page);
  await page.locator("#q").fill("e");
  await expect.poll(() => loadedRows(page)).toBe(PAGE);
  const box = (await scroller(page).boundingBox())!;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + box.height - 40);
  await page.mouse.down();
  await page.mouse.move(x, box.y + 40, { steps: 15 });
  await page.mouse.up();
  await expect.poll(() => scroller(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(3 * ROW);
  await expect(page.locator("#entry")).toBeHidden();
});

test("every row lines up on the typed fragment", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("tion");
  await expect(page.locator("li.word mark.frag").first()).toBeVisible();
  const lefts = await page.locator("li.word mark.frag").evaluateAll((marks) =>
    marks.map((m) => Math.round(m.getBoundingClientRect().left)),
  );
  expect(lefts.length).toBeGreaterThan(5);
  expect(new Set(lefts).size).toBe(1); // one seam
  await expect(page.locator("li.word mark.frag").first()).toHaveText("tion");
});

test("tapping a word opens it, with its Wiktionary link", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("resume");
  await page.locator("#opt-0").click();
  await expect(page.locator("#entry-word")).toHaveText("resume");
  await expect(page.locator("#entry-forms")).toContainText("Résumé");
  await expect(page.locator("#entry-link")).toHaveAttribute("href", "https://en.wiktionary.org/wiki/resume");
  await expect(page.locator("#q")).toHaveAttribute("aria-expanded", "false");
});

test("arrow keys move through the results and Enter opens one", async ({ page }) => {
  await open(page);
  const input = page.locator("#q");
  await input.fill("e");
  await expect.poll(() => loadedRows(page)).toBe(PAGE);
  for (let i = 0; i < 3; i++) await input.press("ArrowDown");
  await expect(input).toHaveAttribute("aria-activedescendant", "opt-2");
  await expect(page.locator("#opt-2")).toHaveAttribute("aria-selected", "true");
  const word = await page.locator("#opt-2").getAttribute("aria-label");
  await input.press("Enter");
  await expect(page.locator("#entry-word")).toHaveText(word!);
});

test("fast typing shows results for the final text only", async ({ page }) => {
  await open(page);
  await page.locator("#q").pressSequentially("tion", { delay: 0 });
  await expect(page.locator("#summary")).toContainText("“tion”");
  await expect(page.locator("li.word mark.frag").first()).toHaveText("tion");
});

test("says so when no word contains the fragment", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("qzxqzx");
  await expect(page.locator("#summary")).toHaveText("No word contains “qzxqzx”. Try a shorter piece.");
  await expect(page.locator("li.word")).toHaveCount(0);
});

test("clearing the search brings back the examples", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("e");
  await page.locator("#q").press("Escape");
  await expect(page.locator("#intro")).toBeVisible();
  await page.getByRole("button", { name: "…tion" }).click();
  await expect(page.locator("#q")).toHaveValue("tion");
  await expect(page.locator("li.word").first()).toBeVisible();
});
