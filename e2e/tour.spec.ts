import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

// The first-run tour: four things (search, scrub, peek, filters), in order, each shown
// first and then asked for. Its shows run on the real screen, so most of what's here is
// about them staying out of the way: nothing counts but the person's own action, the list
// is left where it was, a touch always wins, and nothing is left running afterwards.
// And the "?" beside the cog: How It Works, and the tour again.

test.use({ storageState: { cookies: [], origins: [] } }); // a first run

// The fixture, or a release's real word list (release.yml runs this file on it too).
const DATA = process.env.DICTIONARIUS_SAMPLE_DATA ?? "test/fixtures";
const REAL = existsSync(`${DATA}/headwords.bin`);
const INDEX = REAL ? "headwords.bin" : "headwords-sample.bin";
const LOAD_MS = REAL ? 120_000 : 10_000; // the real list takes a while to open in a browser
test.describe.configure({ timeout: 60_000 + LOAD_MS });
// The tests tagged @release also run on the real list before a release goes out (release.yml).

type Motion = "reduce" | "no-preference";

/** A first start. With reduced motion the start screen is still (a piece can be tapped)
 *  and the tour shows each step without acting it out. */
async function firstRun(page: Page, motion: Motion = "reduce") {
  await page.emulateMedia({ reducedMotion: motion });
  await page.goto(`/?index=${INDEX}`);
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/, { timeout: LOAD_MS });
  await expect(page.locator("#loader")).toHaveCount(0, { timeout: LOAD_MS });
}

const card = (page: Page) => page.locator("#coach");
const count = (page: Page) => page.locator("#coach .coach-count");
const words = (page: Page) => page.locator("#coach .coach-text");
const ring = (page: Page) => page.locator("#coach-finger");
const glow = (page: Page) => page.locator("#coach-glow");

async function middle(page: Page, selector: string) {
  const target = page.locator(selector);
  await expect(target).toBeVisible();
  const box = (await target.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Step 1, by typing (the pieces drift when motion is on); the keyboard put away. */
async function searchByTyping(page: Page) {
  await page.locator("#q").fill("ate");
  await page.locator("#q").blur();
  await expect(page.locator("#frame")).toBeVisible();
  await expect(count(page)).toHaveText("2 of 4");
}

/** Press, wait past a hold, slide sideways, let go: the slider, by hand. */
async function scrubAt(page: Page, at: { x: number; y: number }) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(600);
  for (let dx = 4; dx <= 72; dx += 4) await page.mouse.move(at.x - dx, at.y);
  await expect(page.locator(".slider")).toHaveClass(/\bon\b/);
  await page.mouse.up();
}

/** Press and hold a word: its peek opens; let go. */
async function holdAt(page: Page, at: { x: number; y: number }) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect(page.locator("#peek")).toBeVisible();
  await page.mouse.up();
}

/** The letters of a word wholly on screen (the list draws a few rows off screen too). */
async function wordOnScreen(page: Page) {
  return page.evaluate(() => {
    const view = document.getElementById("scroller")!.getBoundingClientRect();
    for (const row of document.querySelectorAll("#scroller li.word:not(.pending)")) {
      const box = row.getBoundingClientRect();
      if (box.top < view.top || box.bottom > view.bottom) continue;
      const letters = row.querySelector(".frag")!.getBoundingClientRect();
      return { x: letters.left + letters.width / 2, y: letters.top + letters.height / 2 };
    }
    throw new Error("no word on screen");
  });
}

/** On to step 3 by doing steps 1 and 2 (after the scrubber's show, if it has one). */
async function toPeekStep(page: Page) {
  await searchByTyping(page);
  await expect(ring(page)).toHaveAttribute("data-gesture", "slide", { timeout: 10_000 });
  await scrubAt(page, await middle(page, "#coach-finger"));
  await expect(count(page)).toHaveText("3 of 4");
}

/** Every animation the tour has running (on its note, ring and highlight). */
const tourAnimations = (page: Page) =>
  page.evaluate(() =>
    document.getAnimations().filter((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target;
      return !!target && !!(target as Element).closest?.("#coach, #coach-finger, #coach-glow");
    }).length,
  );

test("a first run is shown four things, one at a time, and moves on as each is done", { tag: "@release" }, async ({ page }) => {
  await firstRun(page);
  await expect(card(page)).toBeVisible();
  await expect(count(page)).toHaveText("1 of 4");
  await expect(words(page)).toHaveText("Tap a piece below to search for it and open every word with it inside:");

  // 1. A piece: its list opens.
  await page.locator("#examples button.tile").first().click();
  await expect(page.locator("#frame")).toBeVisible();
  await expect(count(page)).toHaveText("2 of 4");
  await expect(words(page)).toHaveText("Press & Hold beside a word, then drag Left or Right to move where the piece goes:");

  // 2. Hold beside a word, where the ring is, and drag: the slider.
  await expect(ring(page)).toHaveAttribute("data-gesture", "slide");
  await scrubAt(page, await middle(page, "#coach-finger"));
  await expect(count(page)).toHaveText("3 of 4");
  await expect(words(page)).toHaveText("Press & Hold a word to peek at what it means:");
  await expect(ring(page)).toBeHidden(); // the peek step lights words instead

  // 3. Hold the lit word: its peek.
  await holdAt(page, await middle(page, "#coach-glow"));
  await expect(count(page)).toHaveText("4 of 4");
  await expect(words(page)).toHaveText("Tap the funnel to choose how long the words can be:");
  await expect(glow(page)).toBeHidden();

  // 4. The funnel, where the ring is: the filters, then back to the list.
  const funnel = (await page.locator("#filters-open").boundingBox())!;
  const at = await middle(page, "#coach-finger");
  expect(at.x).toBeGreaterThan(funnel.x);
  expect(at.x).toBeLessThan(funnel.x + funnel.width);
  await page.locator("#filters-open").click();
  await expect(page.locator("#filters")).toBeVisible();
  await page.locator("#filters").getByRole("button", { name: "Done" }).click();
  await expect(card(page)).toContainText("That's all four");
  await expect(ring(page)).toBeHidden();
  await expect(card(page)).toBeHidden({ timeout: 8000 });

  // Done for good: not again on the next start.
  await page.reload();
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/, { timeout: LOAD_MS });
  await expect(page.locator("#examples button.tile").first()).toBeVisible();
  await expect(card(page)).toBeHidden();
});

test("each step waits for its own action: nothing done early counts", async ({ page }) => {
  await firstRun(page);
  await page.locator("#examples button.tile").first().click();
  await expect(count(page)).toHaveText("2 of 4");

  // A peek, or the filters, during the scrubber's step: not yet.
  await holdAt(page, await wordOnScreen(page));
  await page.locator("#filters-open").click();
  await page.locator("#filters").getByRole("button", { name: "Done" }).click();
  await expect(count(page)).toHaveText("2 of 4");

  // The scrubber: on to the peek; another scrub there doesn't skip it.
  await scrubAt(page, await middle(page, "#coach-finger"));
  await expect(count(page)).toHaveText("3 of 4");
  await page.locator("#filters-open").click();
  await page.locator("#filters").getByRole("button", { name: "Done" }).click();
  await expect(count(page)).toHaveText("3 of 4");
});

test("typing a search does the first step too", async ({ page }) => {
  await firstRun(page);
  await searchByTyping(page);
});

test("the scrubber shows itself: the slider moves the piece with no input, then the list is as it was", { tag: "@release" }, async ({ page }) => {
  await firstRun(page, "no-preference");
  // Watch every frame from the search on: the slider, where the list is, the step.
  await page.evaluate(() => {
    const frames: { on: boolean; top: number; step: string }[] = [];
    (window as unknown as { frames_: typeof frames }).frames_ = frames;
    const scroller = document.getElementById("scroller")!;
    const watch = () => {
      frames.push({
        on: !!document.querySelector(".slider.on"),
        top: scroller.scrollTop,
        step: document.querySelector(".coach-count")?.textContent ?? "",
      });
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await searchByTyping(page);
  await expect(page.locator(".slider")).toHaveClass(/\bon\b/, { timeout: 5000 }); // by itself
  await expect(ring(page)).toHaveAttribute("data-gesture", "slide", { timeout: 10_000 }); // the show is over
  await expect(page.locator(".slider")).not.toHaveClass(/\bon\b/);

  const frames = await page.evaluate(() => (window as unknown as { frames_: { on: boolean; top: number; step: string }[] }).frames_);
  const first = frames.findIndex((f) => f.on);
  const last = frames.length - 1 - [...frames].reverse().findIndex((f) => f.on);
  const before = frames[first - 1].top;
  expect(frames.slice(first, last + 1).some((f) => f.top !== before)).toBe(true); // the piece moved the list
  expect(frames[frames.length - 1].top).toBe(before); // and it's back where it was
  expect(frames.slice(first).every((f) => f.step === "2 of 4")).toBe(true); // the show isn't the person's go
  await expect(count(page)).toHaveText("2 of 4");

  // Then it's the person's go.
  await scrubAt(page, await middle(page, "#coach-finger"));
  await expect(count(page)).toHaveText("3 of 4");
});

test("a touch during the scrubber's show stops it at once, the list where it was", async ({ page }) => {
  await firstRun(page, "no-preference");
  await searchByTyping(page);
  const scroller = page.locator("#scroller");
  const before = await scroller.evaluate((el) => el.scrollTop);
  await expect(page.locator(".slider")).toHaveClass(/\bon\b/, { timeout: 5000 });
  // A press anywhere (here, the line of counts over the list): the show gives way.
  const summary = await middle(page, "#summary");
  await page.mouse.move(summary.x, summary.y);
  await page.mouse.down();
  await expect(page.locator(".slider")).not.toHaveClass(/\bon\b/);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(before);
  await page.mouse.up();
  await expect(ring(page)).toHaveAttribute("data-gesture", "slide"); // straight to asking
  await page.waitForTimeout(1500);
  await expect(page.locator(".slider")).not.toHaveClass(/\bon\b/); // and it doesn't start again
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(before);
  await expect(count(page)).toHaveText("2 of 4");
});

test("a finger already on the list when the scrubber's show is due keeps it: no show, nothing put back", { tag: "@release" }, async ({ page }) => {
  await firstRun(page, "no-preference");
  await searchByTyping(page);
  // Straight away, before the show's moment: hold beside a word, and drag slowly, well past it.
  let at: { x: number; y: number } | null = null;
  await expect.poll(async () => (at = await page.evaluate(() => {
    const view = document.getElementById("scroller")!.getBoundingClientRect();
    for (const row of document.querySelectorAll("#scroller li.word:not(.pending)")) {
      const box = row.getBoundingClientRect();
      const end = Math.max(...[...row.querySelectorAll(".before, .frag, .after")].map((part) => part.getBoundingClientRect().right));
      if (box.top >= view.top && box.bottom <= view.bottom && end < view.right - 96) {
        return { x: view.right - 40, y: box.top + box.height / 2 };
      }
    }
    return null;
  }))).not.toBeNull();
  at = at!;
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { gestures_: string[] }).gestures_ = seen;
    const ring = document.getElementById("coach-finger")!;
    const watch = () => {
      if (!ring.hidden) seen.push(ring.dataset.gesture ?? "");
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  const scroller = page.locator("#scroller");
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(600);
  for (let dx = 4; dx <= 120; dx += 4) {
    await page.mouse.move(at.x - dx, at.y);
    await page.waitForTimeout(40); // about two seconds of dragging, all through the show's moment
  }
  await expect(page.locator(".slider")).toHaveClass(/\bon\b/);
  const held = await scroller.evaluate((el) => el.scrollTop);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(held); // where the person left it
  const gestures = await page.evaluate(() => (window as unknown as { gestures_: string[] }).gestures_);
  expect(gestures.filter((g) => g === "press" || g === "drag" || g === "lift")).toEqual([]); // no show
  await expect(count(page)).toHaveText("3 of 4"); // and the person's own go counted
});

test("the peek step lights whole words, see-through and borderless, in no particular order, each once before any again", { tag: "@release" }, async ({ page }) => {
  test.setTimeout(90_000 + LOAD_MS);
  await firstRun(page, "no-preference");
  await searchByTyping(page);
  await expect(ring(page)).toHaveAttribute("data-gesture", "slide", { timeout: 10_000 });

  // Which word it lights, frame by frame from its very first, and how well it covers it:
  // the whole word (every letter, not only the piece), as much of it as the row shows.
  const recording = page.evaluate(async () => {
    const light = document.getElementById("coach-glow")!;
    const waitUntil = performance.now() + 15_000;
    while (light.hidden && performance.now() < waitUntil) await new Promise(requestAnimationFrame);
    const scroller = document.getElementById("scroller")!;
    const note = document.getElementById("coach")!;
    const wordOf = (row: Element) => {
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
      for (const part of row.querySelectorAll(".before, .frag, .after")) {
        const b = part.getBoundingClientRect();
        if (b.width === 0) continue;
        left = Math.min(left, b.left); right = Math.max(right, b.right);
        top = Math.min(top, b.top); bottom = Math.max(bottom, b.bottom);
      }
      const track = row.querySelector(".track")!.getBoundingClientRect();
      return { left: Math.max(left, track.left), right: Math.min(right, track.right), top, bottom };
    };
    // The words fully on screen, clear of the note: the ones it can light.
    const view = scroller.getBoundingClientRect();
    const noteTop = note.getBoundingClientRect().top;
    const eligible = [...scroller.querySelectorAll<HTMLElement>("li.word:not(.pending)")]
      .filter((row) => {
        const b = row.getBoundingClientRect();
        return b.top >= view.top && b.bottom <= Math.min(view.bottom, noteTop);
      })
      .map((row) => row.dataset.row!);
    const seen: { row: string; covers: boolean }[] = [];
    const until = performance.now() + 1500 * (eligible.length + 2);
    while (performance.now() < until && seen.length < eligible.length + 2) {
      await new Promise(requestAnimationFrame);
      if (light.hidden) continue;
      const g = light.getBoundingClientRect();
      const cy = g.top + g.height / 2;
      const row = [...scroller.querySelectorAll<HTMLElement>("li.word:not(.pending)")].find((r) => {
        const w = wordOf(r);
        return cy > w.top && cy < w.bottom;
      });
      if (!row || seen.at(-1)?.row === row.dataset.row) continue;
      const w = wordOf(row);
      seen.push({ row: row.dataset.row!, covers: g.left <= w.left + 1 && g.right >= w.right - 1 && g.top <= w.top + 1 && g.bottom >= w.bottom - 1 });
    }
    return { eligible, seen };
  });
  await scrubAt(page, await middle(page, "#coach-finger"));
  await expect(count(page)).toHaveText("3 of 4");
  await expect(glow(page)).toBeVisible();

  // The highlight itself: no border, see-through.
  const look = await glow(page).evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopStyle === "none" || parseFloat(s.borderTopWidth) === 0, background: s.backgroundColor };
  });
  expect(look.border).toBe(true);
  expect(look.background).toMatch(/rgba?\(.*,\s*0?\.\d+\)|color\(srgb .* \/ 0?\.\d+\)|oklab|color-mix/); // translucent

  const hops = await recording;
  const order = hops.seen.map((h) => h.row);
  expect(hops.eligible.length).toBeGreaterThanOrEqual(6); // enough that an order means something
  expect(order.length).toBe(hops.eligible.length + 2);
  expect(hops.seen.every((h) => h.covers)).toBe(true); // the whole word, every time
  const round = order.slice(0, hops.eligible.length);
  expect([...round].sort()).toEqual([...hops.eligible].sort()); // every word on screen, each once
  for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]); // never twice running
  const topToBottom = [...round].sort((a, b) => Number(a) - Number(b));
  expect(round).not.toEqual(topToBottom); // in no particular order
  expect(round).not.toEqual([...topToBottom].reverse());

  // Until the person holds one.
  await holdAt(page, await middle(page, "#coach-glow"));
  await expect(count(page)).toHaveText("4 of 4");
  await expect(glow(page)).toBeHidden();
});

test("the tour stays out of the way: a tap on a lit word opens it, and Back brings the step back", async ({ page }) => {
  await firstRun(page);
  await toPeekStep(page);
  // Nothing the tour draws takes a touch.
  for (const id of ["coach", "coach-glow"]) {
    const at = await middle(page, `#${id}`);
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("#coach, #coach-glow, #coach-finger")?.id ?? null, at);
    expect(hit === null || hit === "coach").toBe(true); // only the note's Skip button takes one, on the note
  }
  const lit = await middle(page, "#coach-glow");
  const label = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("li.word")?.getAttribute("aria-label"), lit);
  expect(label).toBeTruthy();
  await page.mouse.click(lit.x, lit.y);
  await expect(page.locator("#entry")).toBeVisible();
  await expect(page.locator("#entry")).toContainText(label!);
  await expect(glow(page)).toBeHidden(); // not over a word's page
  await expect(card(page)).toBeHidden();
  await page.goBack();
  await expect(page.locator("#frame")).toBeVisible();
  await expect(count(page)).toHaveText("3 of 4");
  await expect(glow(page)).toBeVisible();
});

test("Skip ends the tour for good, and leaves nothing running", async ({ page }) => {
  await firstRun(page, "no-preference");
  await toPeekStep(page);
  await expect(glow(page)).toBeVisible();
  await card(page).getByRole("button", { name: "Skip" }).click();
  await expect(card(page)).toBeHidden();
  await expect(glow(page)).toBeHidden();
  await expect(ring(page)).toBeHidden();
  await page.waitForTimeout(2000);
  await expect(glow(page)).toBeHidden();
  expect(await tourAnimations(page)).toBe(0);
  await page.reload();
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/, { timeout: LOAD_MS });
  await expect(card(page)).toBeHidden();
  await page.locator("#q").fill("ate");
  await page.waitForTimeout(1500);
  await expect(page.locator(".slider")).not.toHaveClass(/\bon\b/); // no show either
  await expect(ring(page)).toBeHidden();
});

test("the note is never a wall, and never covers what a step is about", async ({ page }) => {
  await firstRun(page);
  const view = page.viewportSize()!;
  const note = async () => (await card(page).boundingBox())!;
  // 1: the pieces.
  const pieces = (await page.locator("#examples").boundingBox())!;
  expect((await note()).y + (await note()).height).toBeLessThanOrEqual(pieces.y);
  await page.locator("#examples button.tile").first().click();
  // 2: the space beside a word, where the ring is.
  expect((await note()).height).toBeLessThan(view.height / 3);
  expect((await middle(page, "#coach-finger")).y).toBeLessThan((await note()).y);
  await scrubAt(page, await middle(page, "#coach-finger"));
  // 3: the lit word.
  await expect(glow(page)).toBeVisible();
  const lit = (await glow(page).boundingBox())!;
  expect(lit.y + lit.height).toBeLessThanOrEqual((await note()).y);
});

test("the start screen has no guide text of its own: the tour says it", async ({ page }) => {
  await page.context().addInitScript(() => localStorage.setItem("dictionarius.tour", "done"));
  await firstRun(page);
  await expect(page.locator("#intro")).not.toContainText("pick one");
  await expect(page.locator(".bag-label")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Pieces to search for" })).toBeVisible();
});

test("the ? beside the cog shows How It Works, and can start the tour again", async ({ page }) => {
  await page.context().addInitScript(() => localStorage.setItem("dictionarius.tour", "done"));
  await firstRun(page);
  const help = page.locator("#help-open");
  const cog = page.locator("#settings-open");
  expect((await help.boundingBox())!.x).toBeLessThan((await cog.boundingBox())!.x); // to the left of the cog
  await expect(help).toHaveAccessibleName("How It Works");
  await help.click();
  const sheet = page.locator("#help");
  await expect(sheet.getByRole("heading")).toHaveText("How It Works");
  await expect(sheet.locator("dt")).toHaveText([
    "Tap a piece at the bottom of the start screen",
    "Tap a word",
    "Hold a word",
    "Press & Hold beside a word to see the frequency graph",
    "Back",
  ]);
  await expect(sheet.locator("dd")).toHaveText([
    "to search for it and open its word list",
    "for its dictionary result page",
    "to peek at what it means",
    "then drag Left or Right to move where the piece goes",
    "returns to the word list, where you left it",
  ]);
  await sheet.getByRole("button", { name: "Show me again" }).click();
  await expect(sheet).toBeHidden();
  await expect(count(page)).toHaveText("1 of 4");
});
