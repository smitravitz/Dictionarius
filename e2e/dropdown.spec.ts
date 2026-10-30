import { test, expect, type Page } from "@playwright/test";

const ROW = 52; // ROW_HEIGHT in web/results-list.ts
const PAGE = 50; // PAGE_SIZE in web/protocol.ts

/** Open the app on the fixture index and wait until it has loaded. */
async function open(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
}

/** How long the list is (rows loaded or not): its height in rows, minus the footer. */
const listRows = (page: Page) =>
  page.locator("#results").evaluate((el) => Math.round(el.getBoundingClientRect().height / 52) - 1);

/** Wait until every match is counted: the summary's total is exact. */
async function counted(page: Page) {
  await expect(page.locator("#summary")).toHaveText(/ [\d,]+ in all$/); // not "about …" or "…"
  return Number((await page.locator("#summary").textContent())!.match(/([\d,]+) in all$/)![1].replace(/,/g, ""));
}

/** Rows drawn in the visible part of the list that are still waiting for their words. */
const pendingInView = (page: Page) =>
  page.locator("#scroller").evaluate((scroller) => {
    const box = scroller.getBoundingClientRect();
    return [...scroller.querySelectorAll("li.word.pending")].filter((row) => {
      const r = row.getBoundingClientRect();
      return r.bottom > box.top && r.top < box.bottom;
    }).length;
  });

const scroller = (page: Page) => page.locator("#scroller");

test("shows how many words are loaded", async ({ page }) => {
  await open(page);
  await expect(page.locator("#status")).toHaveText("17,082 words");
});

test("a magnifying glass sits at the end of the search field, beside the funnel, and focuses it", async ({ page }) => {
  await open(page);
  const lens = page.locator(".search .lens");
  await expect(lens).toBeVisible();
  const field = (await page.locator(".search .field").boundingBox())!;
  const glass = (await lens.locator("svg").boundingBox())!; // the glyph; its tap area reaches further
  const funnel = (await page.getByRole("button", { name: "Filters" }).boundingBox())!;
  // Inside the field, on the right, over its underline; the funnel just past it.
  expect(glass.x).toBeGreaterThan(field.x + field.width / 2);
  expect(glass.x + glass.width).toBeLessThanOrEqual(field.x + field.width + 1);
  expect(funnel.x - (glass.x + glass.width)).toBeLessThan(24);
  expect(Math.abs(glass.y + glass.height / 2 - (funnel.y + funnel.height / 2))).toBeLessThan(6);
  await page.locator("#q").blur();
  await lens.click();
  await expect(page.locator("#q")).toBeFocused();
});

test("while typing, a cross takes the glass's place and clears the search; away from the field the glass is back", async ({
  page,
}) => {
  await open(page);
  const q = page.locator("#q");
  const lens = page.locator(".search .lens");
  const clear = page.getByRole("button", { name: "Clear the search" });
  const funnel = (await page.getByRole("button", { name: "Filters" }).boundingBox())!;
  await q.fill("a");
  await expect(lens).toBeHidden();
  await expect(clear).toBeVisible();
  // In the glass's place: just before the funnel, big enough for a thumb.
  const cross = (await clear.boundingBox())!;
  expect(funnel.x - (cross.x + cross.width)).toBeLessThan(24);
  expect(cross.height).toBeGreaterThanOrEqual(44);
  expect(await page.locator(".search .field svg:visible").count()).toBe(1); // one icon, not two

  await clear.click();
  await expect(q).toHaveValue("");
  await expect(q).toBeFocused(); // still typing: the keyboard stays up
  await expect(page.locator("#intro")).toBeVisible();
  await expect(clear).toBeHidden(); // nothing left to clear
  await expect(lens).toBeVisible();

  await q.fill("a");
  await q.blur();
  await expect(clear).toBeHidden();
  await expect(lens).toBeVisible();
});

test("typing shows results straight away, exact match first", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("e");
  await expect(page.locator("#q")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#opt-0")).toHaveText("e");
  await expect(page.locator("li.word[role=option]").first()).toHaveAttribute("aria-posinset", "1");
});

test("the list is as long as every match, and fills in wherever you scroll", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("e");
  const total = await counted(page);
  expect(total).toBeGreaterThan(10 * PAGE);
  await expect.poll(() => listRows(page)).toBe(total);
  for (const share of [0.5, 0.9, 0.2]) {
    await scroller(page).evaluate((el, share) => (el.scrollTop = el.scrollHeight * share), share);
    await expect.poll(() => pendingInView(page)).toBe(0); // the page under the viewport arrived
  }
  // Only rows near the viewport exist in the page, however long the list.
  expect(await page.locator("li.word").count()).toBeLessThan(40);
  await scroller(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(page.locator("li.foot")).toHaveText(`That’s all ${total.toLocaleString("en-US")}.`);
});

test("a touch drag scrolls the list and lazily loads more", async ({ page, isMobile }) => {
  test.skip(!isMobile, "touch gesture on the phone project");
  await open(page);
  await page.locator("#q").fill("e");
  await expect(page.locator("#opt-0")).toHaveText("e");
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
  await expect.poll(() => pendingInView(page)).toBe(0);
  await expect(page.locator("#entry")).toBeHidden(); // dragging didn't open a word
});

test("a mouse drag scrolls the list without opening a word", async ({ page, isMobile }) => {
  test.skip(isMobile, "mouse drag on the desktop project");
  await open(page);
  await page.locator("#q").fill("e");
  await expect(page.locator("#opt-0")).toHaveText("e");
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
    marks.map((m) => m.getBoundingClientRect().left),
  );
  expect(lefts.length).toBeGreaterThan(5);
  expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1.5); // one seam
  await expect(page.locator("li.word mark.frag").first()).toHaveText("tion");
});

test("tapping a word opens it, crediting its Wiktionary page in the footer", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("resume");
  await page.locator("#opt-0").click();
  await expect(page.locator("#entry-word")).toHaveText("resume");
  await expect(page.locator("#entry-forms")).toContainText("Résumé");
  await expect(page.locator("#source")).toHaveAttribute("href", "https://en.wiktionary.org/wiki/resume");
  await expect(page.locator("#q")).toHaveAttribute("aria-expanded", "false");
});

test("Back closes the word and returns to the same results", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("e");
  await expect(page.locator("#opt-0")).toHaveText("e");
  await scroller(page).evaluate((el) => (el.scrollTop = 10 * 52));
  // Wait for the rows near row 10 to render, then open one of them.
  const row = page.locator('li.word[aria-posinset="12"]');
  const word = await row.getAttribute("aria-label");
  await row.click();
  await expect(page.locator("#entry-word")).toHaveText(word!);
  await page.goBack();
  await expect(page.locator("#entry")).toBeHidden();
  await expect(page.locator("#q")).toHaveValue("e");
  await expect(page.locator("#q")).toHaveAttribute("aria-expanded", "true");
  expect(await scroller(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(5 * ROW); // still scrolled
  await expect(page.locator("#summary")).toContainText("“e”");
});

test("arrow keys move through the results and Enter opens one", async ({ page }) => {
  await open(page);
  const input = page.locator("#q");
  await input.fill("e");
  await expect(page.locator("#opt-0")).toHaveText("e");
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

test("the start screen is a title page: the name, what it finds, the word count, and a bag of pieces", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("heading", { level: 1, name: "Dictionarius" })).toBeVisible();
  await expect(page.locator("#title")).toContainText("finds a word from any part of it");
  await expect(page.locator("#facts")).toHaveText("17,082 words · every definition · fully offline");
  await expect(page.locator("#status")).toBeHidden(); // the count is in the facts line here

  const tiles = page.locator("#examples button");
  expect(await tiles.count()).toBe(20);
  const labels = await tiles.allTextContents();
  expect(labels.slice(0, 4)).toEqual(["…tion", "un…", "…ough…", "…ness"]);
  expect(new Set(labels).size).toBe(labels.length);
  // Bigger for pieces that find more words, but only a little.
  const size = (name: string) =>
    page.getByRole("button", { name, exact: true }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(await size("…ing")).toBeGreaterThan(await size("…hood"));
  expect((await size("…ing")) / (await size("…hood"))).toBeLessThan(1.35);

  await page.getByRole("button", { name: "…ough…", exact: true }).click();
  await expect(page.locator("#q")).toHaveValue("ough");
  await expect(page.locator("li.word mark.frag").first()).toHaveText("ough");
  // With results showing, the title page gives way to the usual header.
  await expect(page.locator("#title")).toBeHidden();
  await expect(page.locator("#status")).toBeVisible();
});

for (const width of [412, 360]) {
  test(`the bag sits four to a row, none stranded or cut off, ${width} px wide`, async ({ page, isMobile }) => {
    test.skip(!isMobile, "a phone's screen");
    await page.setViewportSize({ width, height: width === 412 ? 839 : 740 });
    await open(page);
    const rows = page.locator("#examples .bag-row");
    expect(await rows.count()).toBe(5);
    const footerTop = await page.locator(".credit").evaluate((el) => el.getBoundingClientRect().top);
    for (const row of await rows.all()) {
      expect(await row.locator("button").count()).toBe(4);
      expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      for (const tile of await row.locator("button").all()) {
        const box = (await tile.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.y + box.height, "in view without scrolling").toBeLessThanOrEqual(footerTop);
      }
    }
  });
}

test("the space under the bag answers the space over the name: less, but in proportion", async ({ page, isMobile }) => {
  test.skip(!isMobile, "a phone's screen");
  await page.setViewportSize({ width: 412, height: 839 });
  await open(page);
  const top = await page.getByRole("heading", { level: 1 }).evaluate((el) => el.getBoundingClientRect().top);
  const bagBottom = await page.locator("#examples").evaluate((el) => el.getBoundingClientRect().bottom);
  const footerTop = await page.locator(".credit").evaluate((el) => el.getBoundingClientRect().top);
  const below = footerTop - bagBottom;
  expect(below).toBeLessThan(top);
  expect(below).toBeGreaterThan(top * 0.45);
});

test("a word too long for the row scrolls sideways to show its start", async ({ page, isMobile }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  await open(page);
  await page.locator("#q").fill("veness");
  const row = page.locator('li.word[aria-label="philoprogenitiveness"]');
  const track = row.locator(".track");
  // At rest the fragment sits on the seam, so the start is scrolled out of view.
  await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  const seamLeft = await page.locator(".seam").evaluate((el) => el.getBoundingClientRect().left);
  const fragLeft = await row.locator("mark.frag").evaluate((el) => el.getBoundingClientRect().left);
  expect(Math.abs(fragLeft - seamLeft)).toBeLessThanOrEqual(1.5);

  await row.scrollIntoViewIfNeeded();
  const box = (await track.boundingBox())!;
  const y = Math.round(box.y + box.height / 2);
  const topBefore = await scroller(page).evaluate((el) => el.scrollTop);
  if (isMobile) {
    // A finger swipe to the right, as a phone sends it.
    const cdp = await page.context().newCDPSession(page);
    let x = Math.round(box.x + 40);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let step = 0; step < 10; step++) {
      x += 20;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page.mouse.move(box.x + 40, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 240, y, { steps: 10 });
    await page.mouse.up();
  }
  await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBe(0);
  // The whole start of the word is now inside the row.
  const trackLeft = await track.evaluate((el) => el.getBoundingClientRect().left);
  const beforeLeft = await row.locator(".before").evaluate((el) => el.getBoundingClientRect().left);
  expect(beforeLeft).toBeGreaterThanOrEqual(trackLeft);
  expect(await scroller(page).evaluate((el) => el.scrollTop)).toBe(topBefore); // the list stayed put
  await expect(page.locator("#entry")).toBeHidden(); // and no word opened
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
