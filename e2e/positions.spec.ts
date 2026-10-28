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

/** Letters before the fragment in the row at the top of the list. */
const topLetters = (page: Page) =>
  page.locator("#scroller").evaluate((scroller) => {
    const top = scroller.getBoundingClientRect().top;
    const rows = [...scroller.querySelectorAll<HTMLElement>("li.word:not(.pending)")]
      .filter((row) => row.getBoundingClientRect().top >= top - 1)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return rows.length ? Array.from(rows[0].querySelector(".before")!.textContent ?? "").length : -1;
  });

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

test("holding a blank spot opens the scrubber; the screen's width spans every position", async ({ page, isMobile }) => {
  await open(page);
  await page.locator("#q").fill("ate");
  await expect(page.locator("#summary")).toHaveText(/in all$/);
  await expect(page.locator("#summary")).not.toHaveText(/about/); // fully counted
  const summary = await page.locator("#summary").textContent();
  const { x, y } = await blankSpot(page.locator("li.word").first());
  const width = page.viewportSize()!.width;

  // A finger (phone) or the mouse (desktop): down, hold still, then move.
  const cdp = isMobile ? await page.context().newCDPSession(page) : null;
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }) =>
    cdp!.send("Input.dispatchTouchEvent", { type, touchPoints: at ? [{ x: Math.round(at.x), y: Math.round(at.y) }] : [] });
  let fingerX = x;
  const slideTo = async (to: number) => {
    for (let i = 1; i <= 8; i++) {
      const at = { x: fingerX + ((to - fingerX) * i) / 8, y };
      if (cdp) await touch("touchMove", at);
      else await page.mouse.move(at.x, at.y);
    }
    fingerX = to;
  };
  if (cdp) await touch("touchStart", { x, y });
  else {
    await page.mouse.move(x, y);
    await page.mouse.down();
  }
  await page.waitForTimeout(600);
  await expect(page.locator(".slider")).toHaveClass(/\bon\b/);

  const bars = page.locator(".slider-track > i");
  const last = (await bars.count()) - 1;
  const centerOf = async (i: number) => {
    const box = (await bars.nth(i).boundingBox())!;
    return box.x + box.width / 2;
  };
  // The bars fit the screen, centred.
  const firstBox = (await bars.first().boundingBox())!;
  const lastBox = (await bars.nth(last).boundingBox())!;
  expect(firstBox.x).toBeGreaterThanOrEqual(0);
  expect(lastBox.x + lastBox.width).toBeLessThanOrEqual(width);
  expect(Math.abs(firstBox.x - (width - (lastBox.x + lastBox.width)))).toBeLessThanOrEqual(width * 0.1);
  expect(lastBox.x + lastBox.width - firstBox.x).toBeLessThanOrEqual(width * 0.8); // margins either side

  // The cursor sits under the finger, and picks the bar there.
  await slideTo(await centerOf(3));
  await expect(page.locator(".slider-note")).toHaveText(/^3 letters before/);
  const thumb = (await page.locator(".slider-thumb").boundingBox())!;
  expect(Math.abs(thumb.x - fingerX)).toBeLessThanOrEqual(2);
  // All the way right is the last position; all the way left, the first.
  await slideTo(width - 2);
  await expect(page.locator(".slider-note")).toHaveText(new RegExp(`^${last} letters before`));
  await slideTo(2);
  await expect(page.locator(".slider-note")).toHaveText(/^0 letters before/);
  await slideTo(await centerOf(3));
  await expect(page.locator(".slider-note")).toHaveText(/^3 letters before/);
  if (cdp) await touch("touchEnd");
  else await page.mouse.up();

  await expect(page.locator(".slider")).not.toHaveClass(/\bon\b/);
  await expect.poll(() => topLetters(page)).toBe(3); // the list jumped to 3 letters before…
  await expect(page.locator("#summary")).toHaveText(summary!);
  // …and is still whole: scroll back up to the words that start with it.
  await page.locator("#scroller").evaluate((el) => (el.scrollTop = 0));
  await expect.poll(() => topLetters(page)).toBe(0);
  await expect(page.locator("#opt-0 mark.frag")).toHaveText("ate");
  await expect(page.locator("#entry")).toBeHidden(); // no word opened
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

test("Alt+arrow keys jump between positions from the keyboard", async ({ page }) => {
  await open(page);
  const input = page.locator("#q");
  await input.fill("ate");
  await expect(page.locator("#summary")).toHaveText(/in all$/);
  await input.press("Alt+ArrowRight");
  await expect.poll(() => topLetters(page)).toBe(1);
  await input.press("Alt+ArrowRight");
  await expect.poll(() => topLetters(page)).toBe(2);
  await input.press("Alt+ArrowLeft");
  await expect.poll(() => topLetters(page)).toBe(1);
  await expect(page.locator("#summary")).toHaveText(/starts? with “ate”/); // still the whole list
});
