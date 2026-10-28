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

/** Press and hold a blank spot near the left of the first row with a finger
 *  (phone) or the mouse (desktop) until the slider opens. */
async function holdBlankSpot(page: Page, isMobile: boolean) {
  const { x, y } = await blankSpot(page.locator("li.word").first());
  const cdp = isMobile ? await page.context().newCDPSession(page) : null;
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }) =>
    cdp!.send("Input.dispatchTouchEvent", { type, touchPoints: at ? [{ x: Math.round(at.x), y: Math.round(at.y) }] : [] });
  let fingerX = x;
  if (cdp) await touch("touchStart", { x, y });
  else {
    await page.mouse.move(x, y);
    await page.mouse.down();
  }
  await page.waitForTimeout(600);
  await expect(page.locator(".slider")).toHaveClass(/\bon\b/);
  return {
    /** Slide sideways to screen x, in small steps. */
    async slideTo(to: number) {
      for (let i = 1; i <= 8; i++) {
        const at = { x: fingerX + ((to - fingerX) * i) / 8, y };
        if (cdp) await touch("touchMove", at);
        else await page.mouse.move(at.x, at.y);
      }
      fingerX = to;
    },
    get x() {
      return fingerX;
    },
    async lift() {
      if (cdp) await touch("touchEnd");
      else await page.mouse.up();
    },
  };
}

/** Wait until every position is counted, so the slider's layout is final. */
async function counted(page: Page) {
  await expect(page.locator("#summary")).toHaveText(/in all$/);
  await expect(page.locator("#summary")).not.toHaveText(/about/);
}

test("holding a blank spot opens the scrubber; the screen's width spans every position", async ({ page, isMobile }) => {
  await open(page);
  await page.locator("#q").fill("ate");
  await counted(page);
  const summary = await page.locator("#summary").textContent();
  const width = page.viewportSize()!.width;
  const finger = await holdBlankSpot(page, isMobile);

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
  await finger.slideTo(await centerOf(3));
  await expect(page.locator(".slider-note")).toHaveText(/^3 letters before/);
  const thumb = (await page.locator(".slider-thumb").boundingBox())!;
  expect(Math.abs(thumb.x - finger.x)).toBeLessThanOrEqual(2);
  // All the way right is the last position; all the way left, the first.
  await finger.slideTo(width - 2);
  await expect(page.locator(".slider-note")).toHaveText(new RegExp(`^${last} letters before`));
  await finger.slideTo(2);
  await expect(page.locator(".slider-note")).toHaveText(/^0 letters before/);
  await finger.slideTo(await centerOf(3));
  await expect(page.locator(".slider-note")).toHaveText(/^3 letters before/);
  await finger.lift();

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

test("on a long list, 6 letters sit at 75% of the scrubber's range and the rare far end is squeezed", async ({ page, isMobile }) => {
  await open(page);
  await page.locator("#q").fill("a"); // 0 to 21 letters before
  await counted(page);
  const finger = await holdBlankSpot(page, isMobile);

  // The active range is the middle 80% of the slider.
  const box = (await page.locator(".slider-window").boundingBox())!;
  const range = (share: number) => box.x + box.width * (0.1 + 0.8 * share);
  await finger.slideTo(range(0.75));
  await expect(page.locator(".slider-note")).toHaveText(/^6 letters before/);
  await finger.slideTo(range(0.5));
  await expect(page.locator(".slider-note")).toHaveText(/^5 letters before/);

  // 0-7 letters fill about 80% of the range; the bars past them are narrow.
  const bars = page.locator(".slider-track > i");
  const left = async (i: number) => (await bars.nth(i).boundingBox())!.x;
  const wide = async (i: number) => (await bars.nth(i).boundingBox())!.width;
  expect((await left(8)) - range(0)).toBeCloseTo(0.82 * 0.8 * box.width, -1);
  expect(await wide(9)).toBeLessThan((await wide(6)) / 3);
  expect(await wide(15)).toBeLessThan(await wide(9));
  await finger.lift();
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

test("in a browser, the slider pulses when it opens and ticks once per step", async ({ page, isMobile }) => {
  // Stand in for the Vibration API, to see what the page asks of it.
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as unknown as { vibrations: unknown[] }).vibrations = calls;
    Object.defineProperty(Navigator.prototype, "vibrate", {
      configurable: true,
      value: (pattern: unknown) => (calls.push(pattern), true),
    });
  });
  const vibrations = () => page.evaluate(() => (window as unknown as { vibrations: unknown[] }).vibrations);
  await open(page);
  await page.locator("#q").fill("ate");
  await counted(page);
  const finger = await holdBlankSpot(page, isMobile);
  expect(await vibrations()).toEqual([15]); // the pulse: the slider is open

  const bars = page.locator(".slider-track > i");
  for (const i of [1, 2, 3]) {
    const box = (await bars.nth(i).boundingBox())!;
    await finger.slideTo(box.x + box.width / 2);
  }
  await expect(page.locator(".slider-note")).toHaveText(/^3 letters before/);
  expect(await vibrations()).toEqual([15, 5, 5, 5]); // a tick per step
  await finger.lift();
});
