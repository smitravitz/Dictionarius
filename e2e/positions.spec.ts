import { test, expect, type Page, type Locator } from "@playwright/test";

/** Open the app on the fixture index and wait until it has loaded. */
async function open(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
}

/** Letters before the fragment in each rendered row, top to bottom. */
const lettersBefore = (page: Page) =>
  page.locator("li.word").evaluateAll((rows) =>
    rows
      .map((row) => ({
        at: Number(row.getAttribute("aria-posinset")),
        n: Array.from(row.querySelector(".before")!.textContent ?? "").length,
      }))
      .sort((a, b) => a.at - b.at)
      .map((r) => r.n),
  );

/** A blank spot near the left of a row whose word starts with the fragment
 *  (nothing sits left of the seam), leaving room to slide right on screen. */
async function blankSpot(row: Locator) {
  const box = (await row.boundingBox())!;
  return { x: Math.round(box.x + 30), y: Math.round(box.y + box.height / 2) };
}

/** Width of one position in the open slider. */
const sliderStep = (page: Page) =>
  page.locator(".slider-track > i").first().evaluate((bar) => parseFloat((bar as HTMLElement).style.width) + 3);

test("words starting with the fragment come first, then 1 letter before it, then 2, …", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("ate");
  await expect(page.locator("li.word").first()).toBeVisible();
  const counts = await lettersBefore(page);
  expect(counts[0]).toBe(0);
  expect(counts).toEqual([...counts].sort((a, b) => a - b));
  expect(new Set(counts).size).toBeGreaterThan(1);
});

test("the summary counts words that start with, end with, and contain the fragment", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("ing");
  const summary = page.locator("#summary");
  await expect(summary).toHaveText(/^[\d,]+ starts? with “ing” · [\d,]+ ends? with it · [\d,]+ in all$/);
  const [starts, ends, total] = ((await summary.textContent())!.match(/[\d,]+/g) ?? []).map((n) => Number(n.replace(/,/g, "")));
  expect(total).toBeGreaterThanOrEqual(Math.max(starts, ends));
});

test("tapping an example searches without opening the keyboard", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "…ing" }).click();
  await expect(page.locator("#q")).toHaveValue("ing");
  await expect(page.locator("li.word").first()).toBeVisible();
  await expect(page.locator("#q")).not.toBeFocused();
});

test("holding a blank spot opens the position slider; sliding picks letters before", async ({ page, isMobile }) => {
  await open(page);
  await page.locator("#q").fill("ate");
  await expect(page.locator("#summary")).toHaveText(/in all$/);
  await expect(page.locator("#summary")).not.toHaveText(/about/); // fully counted
  const { x, y } = await blankSpot(page.locator("li.word").first());
  const topBefore = await page.locator("#scroller").evaluate((el) => el.scrollTop);

  if (isMobile) {
    // A finger: down, hold still, then slide right three steps, lift.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await page.waitForTimeout(600);
    await expect(page.locator(".slider")).toHaveClass(/\bon\b/);
    const step = await sliderStep(page);
    for (let i = 1; i <= 12; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.round(x + (i * 3 * step) / 12), y }] });
    }
    await expect(page.locator(".slider-note")).toHaveText(/^3 letters before/);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await expect(page.locator(".slider")).toHaveClass(/\bon\b/);
    const step = await sliderStep(page);
    await page.mouse.move(x + 3 * step, y, { steps: 12 });
    await expect(page.locator(".slider-note")).toHaveText(/^3 letters before/);
    await page.mouse.up();
  }

  await expect(page.locator(".slider")).not.toHaveClass(/\bon\b/);
  await expect(page.locator("#summary")).toHaveText(/^[\d,]+ with 3 letters before “ate” · [\d,]+ in all$/);
  await expect.poll(async () => (await lettersBefore(page))[0]).toBe(3);
  const counts = await lettersBefore(page);
  expect(Math.min(...counts)).toBe(3);
  expect(await page.locator("#scroller").evaluate((el) => el.scrollTop)).toBe(topBefore); // the list didn't scroll
  await expect(page.locator("#entry")).toBeHidden(); // and no word opened
  await expect(page.locator("#hint")).toBeHidden(); // the tip has done its job
});

test("holding a word itself does not open the slider", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("ate");
  const frag = page.locator("li.word mark.frag").first();
  const box = (await frag.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await expect(page.locator(".slider")).not.toHaveClass(/\bon\b/);
  await page.mouse.up();
});

test("Alt+arrow keys move the position from the keyboard", async ({ page }) => {
  await open(page);
  const input = page.locator("#q");
  await input.fill("ate");
  await expect(page.locator("#summary")).toHaveText(/in all$/);
  await input.press("Alt+ArrowRight");
  await input.press("Alt+ArrowRight");
  await expect(page.locator("#summary")).toHaveText(/with 2 letters before “ate”/);
  await expect.poll(async () => (await lettersBefore(page))[0]).toBe(2);
  await input.press("Alt+ArrowLeft");
  await expect(page.locator("#summary")).toHaveText(/with 1 letter before “ate”/);
});
