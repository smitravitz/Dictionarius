import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

// The first-run tour: five things (search, scrub, peek, filters, settings), in order, each
// shown first and then asked for, by lighting what to touch: a see-through highlight drawn
// by the thing itself, so it moves with it, and only ever fading or pulsing smoothly. The
// slider has nothing to light (it's held in the empty space beside a word), so a touch
// shows it instead, sliding with the histogram, and again after 5 still seconds.
// Most of what's here is about it staying out of the way: nothing counts but the person's
// own action, nothing new shows while they're still touching, the list is left where it
// was, a touch always wins, and nothing is left behind. And the "?" beside the cog: How It
// Works, and the tour again.

test.use({ storageState: { cookies: [], origins: [] } }); // a first run

// The fixture, or a release's real word list (release.yml runs this file on it too).
const DATA = process.env.DICTIONARIUS_SAMPLE_DATA ?? "test/fixtures";
const REAL = existsSync(`${DATA}/headwords.bin`);
const INDEX = REAL ? "headwords.bin" : "headwords-sample.bin";
const LOAD_MS = REAL ? 120_000 : 10_000; // the real list takes a while to open in a browser
test.describe.configure({ timeout: 60_000 + LOAD_MS });
// The tests tagged @release also run on the real list before a release goes out (release.yml).

type Motion = "reduce" | "no-preference";

/** A first start. With reduced motion the start screen is still (a piece can be tapped),
 *  nothing is acted out and the highlight doesn't pulse. */
async function firstRun(page: Page, motion: Motion = "reduce") {
  await page.emulateMedia({ reducedMotion: motion });
  await page.goto(`/?index=${INDEX}`);
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/, { timeout: LOAD_MS });
  await expect(page.locator("#loader")).toHaveCount(0, { timeout: LOAD_MS });
}

const card = (page: Page) => page.locator("#coach");
const count = (page: Page) => page.locator("#coach .coach-count");
const words = (page: Page) => page.locator("#coach .coach-text");
/** What the tour lights now (not what's fading out). */
const lit = (page: Page) => page.locator('[data-tour-lit="on"], [data-tour-lit="held"]');

/** Where the highlight is on screen: its box (the lit thing's ::before). */
async function lightBox(page: Page) {
  await expect(lit(page)).toHaveCount(1);
  return lit(page).evaluate((el) => {
    const at = el.getBoundingClientRect();
    const s = getComputedStyle(el, "::before");
    const left = at.left + parseFloat(s.left);
    const top = at.top + parseFloat(s.top);
    return { left, top, right: left + parseFloat(s.width), bottom: top + parseFloat(s.height) };
  });
}

/** The middle of the highlight. */
async function lightMiddle(page: Page) {
  const box = await lightBox(page);
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
}

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
  await expect(count(page)).toHaveText("2 of 5");
}

/** Press, wait past a hold, slide sideways; let go unless told to keep holding. */
async function scrubAt(page: Page, at: { x: number; y: number }, letGo = true) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(600);
  for (let dx = 4; dx <= 72; dx += 4) await page.mouse.move(at.x - dx, at.y);
  await expect(page.locator(".slider")).toHaveClass(/\bon\b/);
  if (letGo) await page.mouse.up();
}

/** Press and hold a word: its peek opens; let go unless told to keep holding. */
async function holdAt(page: Page, at: { x: number; y: number }, letGo = true) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect(page.locator("#peek")).toBeVisible();
  if (letGo) await page.mouse.up();
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

/** The touch that shows the slider: where to hold, sliding with the histogram. */
const touch = (page: Page) => page.locator("#coach-touch");

/** Where a hold opens the slider: the space beside a short word wholly on screen, clear of
 *  the note (found here, not from the tour). */
async function besideAWord(page: Page) {
  let at: { x: number; y: number } | null = null;
  await expect.poll(async () => (at = await page.evaluate(() => {
    const view = document.getElementById("scroller")!.getBoundingClientRect();
    const note = document.getElementById("coach")!;
    const floor = Math.min(view.bottom, note.hidden ? Infinity : note.getBoundingClientRect().top);
    for (const row of document.querySelectorAll("#scroller li.word:not(.pending)")) {
      const box = row.getBoundingClientRect();
      const end = Math.max(...[...row.querySelectorAll(".before, .frag, .after")].map((part) => part.getBoundingClientRect().right));
      if (box.top >= view.top + 60 && box.bottom <= floor && end < view.right - 96) {
        return { x: view.right - 40, y: box.top + box.height / 2 };
      }
    }
    return null;
  }))).not.toBeNull();
  return at!;
}

/** The scrubber's show, once over (with motion on): the slider opened by itself, then let go. */
async function afterTheShow(page: Page) {
  await expect(page.locator(".slider")).toHaveClass(/\bon\b/, { timeout: 5000 });
  await expect(page.locator(".slider")).not.toHaveClass(/\bon\b/, { timeout: 8000 });
  await expect(touch(page)).toBeHidden();
}

/** On to step 3 by doing steps 1 and 2 (after the scrubber's show, if it has one). */
async function toPeekStep(page: Page, motion: Motion = "reduce") {
  await searchByTyping(page);
  if (motion === "no-preference") await afterTheShow(page);
  else await expect(touch(page)).toBeVisible({ timeout: 10_000 });
  await scrubAt(page, await besideAWord(page));
  await expect(count(page)).toHaveText("3 of 5");
}

/** Every animation the tour has running (on its note and its highlights). */
const tourAnimations = (page: Page) =>
  page.evaluate(() =>
    document.getAnimations().filter((a) => {
      const effect = a.effect as KeyframeEffect | null;
      const target = effect?.target as Element | null;
      return !!target && (!!target.closest("#coach, #coach-touch") || (!!effect?.pseudoElement && target.hasAttribute("data-tour-lit")));
    }).length,
  );

test("a first run is shown five things, one at a time, and moves on as each is done", { tag: "@release" }, async ({ page }) => {
  await firstRun(page);
  await expect(card(page)).toBeVisible();
  await expect(count(page)).toHaveText("1 of 5");
  await expect(words(page)).toHaveText("Tap a piece below to search for it and open every word with it inside:");

  // 1. A piece, lit where it is: its list opens.
  await expect(lit(page)).toHaveCount(1);
  expect(await lit(page).evaluate((el) => !!el.closest("#examples .tile"))).toBe(true);
  await lit(page).click();
  await expect(page.locator("#frame")).toBeVisible();
  await expect(count(page)).toHaveText("2 of 5");
  await expect(words(page)).toHaveText("Hold beside a word, then slide to move where the piece lands mid-word:");

  // 2. Hold where the touch shows, beside a word, and slide: the slider. Nothing lit: an
  // empty space doesn't say what to do; the touch and the note do.
  await expect(touch(page)).toBeVisible({ timeout: 10_000 });
  await expect(lit(page)).toHaveCount(0);
  await scrubAt(page, await middle(page, "#coach-touch"));
  await expect(count(page)).toHaveText("3 of 5");
  await expect(touch(page)).toBeHidden();
  await expect(words(page)).toHaveText("Press & Hold a word to peek at what it means:");

  // 3. Hold the lit word: its peek.
  await expect(page.locator('.line[data-tour-lit="on"]')).toHaveCount(1);
  await holdAt(page, await lightMiddle(page));
  await expect(count(page)).toHaveText("4 of 5");
  await expect(words(page)).toHaveText("Tap the funnel to filter words by length:");

  // 4. The lit funnel; its options lit in the sheet; closing it moves on.
  await expect(page.locator('#filters-open[data-tour-lit="on"]')).toHaveCount(1);
  await page.locator("#filters-open").click();
  await expect(page.locator("#filters")).toBeVisible();
  await expect(page.locator('#filters [data-tour-lit="on"]')).toHaveCount(1);
  await page.locator("#filters").getByRole("button", { name: "Done" }).click();
  await expect(count(page)).toHaveText("5 of 5");
  await expect(words(page)).toHaveText("Tap the cog to choose what the list shows, like safe search:");

  // 5. The lit cog; each of its options lit in turn; closing it finishes.
  await expect(page.locator('#settings-open[data-tour-lit="on"]')).toHaveCount(1);
  await page.locator("#settings-open").click();
  await expect(page.locator("#settings")).toBeVisible();
  const options = await page.locator("#settings .setting").count();
  const seen = new Set<string>();
  await expect.poll(async () => {
    const name = await page.locator('#settings .setting[data-tour-lit="on"] .setting-name').textContent().catch(() => null);
    if (name) seen.add(name);
    return seen.size;
  }, { timeout: 15_000 }).toBe(options);
  await page.locator("#settings").getByRole("button", { name: "Done" }).click();
  await expect(card(page)).toContainText("That's all five");
  await expect(page.locator("[data-tour-lit]")).toHaveCount(0);
  await expect(card(page)).toBeHidden({ timeout: 8000 });

  // Done for good: not again on the next start.
  await page.reload();
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/, { timeout: LOAD_MS });
  await expect(page.locator("#examples button.tile").first()).toBeVisible();
  await expect(card(page)).toBeHidden();
  await expect(page.locator("[data-tour-lit]")).toHaveCount(0);
});

test("each step waits for its own action: nothing done early counts", async ({ page }) => {
  await firstRun(page);
  await page.locator("#examples button.tile").first().click();
  await expect(count(page)).toHaveText("2 of 5");

  // A peek, the filters or the settings during the scrubber's step: not yet.
  await holdAt(page, await wordOnScreen(page));
  for (const [button, sheet] of [["#filters-open", "#filters"], ["#settings-open", "#settings"]]) {
    await page.locator(button).click();
    await page.locator(sheet).getByRole("button", { name: "Done" }).click();
  }
  await page.waitForTimeout(1000);
  await expect(count(page)).toHaveText("2 of 5");

  // The scrubber: on to the peek; the cog there doesn't skip it.
  await scrubAt(page, await middle(page, "#coach-touch"));
  await expect(count(page)).toHaveText("3 of 5");
  await page.locator("#settings-open").click();
  await page.locator("#settings").getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(1000);
  await expect(count(page)).toHaveText("3 of 5");
});

test("typing a search does the first step too", async ({ page }) => {
  await firstRun(page);
  await searchByTyping(page);
});

test("nothing new shows while the person is still holding: the next step waits for them to let go", async ({ page }) => {
  await firstRun(page);
  await page.locator("#examples button.tile").first().click();
  await expect(touch(page)).toBeVisible({ timeout: 10_000 });

  // The scrubber, held on after sliding: step 2 is done, but nothing new yet.
  await scrubAt(page, await middle(page, "#coach-touch"), false);
  await page.waitForTimeout(1500);
  await expect(count(page)).toHaveText("2 of 5 ✓");
  await expect(lit(page)).toHaveCount(0);
  await expect(touch(page)).toBeHidden();
  await page.mouse.up();
  await expect(count(page)).toHaveText("3 of 5", { timeout: 3000 });

  // The peek, held on: the same.
  await holdAt(page, await lightMiddle(page), false);
  await page.waitForTimeout(1500);
  await expect(count(page)).toHaveText("3 of 5 ✓");
  await expect(lit(page)).toHaveCount(0);
  await page.mouse.up();
  await expect(count(page)).toHaveText("4 of 5", { timeout: 3000 });
  await expect(page.locator('#filters-open[data-tour-lit="on"]')).toHaveCount(1);
});

test("the start screen's highlight is drawn by the piece itself, so it moves with it", async ({ page }) => {
  await firstRun(page, "no-preference");
  await expect(lit(page)).toHaveCount(1);
  // On a tile inside a drifting lane: the same element the browser moves, every frame.
  expect(await lit(page).evaluate((el) => !!el.closest(".lane-track") && !!el.closest(".tile"))).toBe(true);
  const before = await lit(page).evaluate((el) => el.getBoundingClientRect().left);
  await page.waitForTimeout(400);
  const after = await lit(page).evaluate((el) => el.getBoundingClientRect().left).catch(() => before);
  expect(after).not.toBe(before); // it drifted, and its highlight with it
  // And there's no overlay chasing it: the tour adds no element of its own.
  await expect(page.locator("#coach-finger, #coach-glow")).toHaveCount(0);
});

test("the highlight is smooth: it only fades and pulses, eased, and never jumps", async ({ page }) => {
  test.setTimeout(90_000 + LOAD_MS);
  await firstRun(page, "no-preference");
  // How it looks, frame by frame, from the start screen's pieces through the scrubber's show
  // and its asking, to the peek's words: every highlight's opacity changes no faster than a
  // gentle fade, so nothing pops in, out or flickers, however one hands over to the next.
  await page.evaluate(() => {
    // Only what's on screen: a row the list took away, or a screen that was hidden, takes
    // its highlight with it, and that's the row or the screen going, not the highlight.
    const shown = (el: Element) => el.isConnected && el.getClientRects().length > 0;
    const sample = () => {
      const seen = new Map<Element, number>();
      for (const el of document.querySelectorAll("[data-tour-lit]")) {
        if (shown(el)) seen.set(el, parseFloat(getComputedStyle(el, "::before").opacity));
      }
      const hand = document.getElementById("coach-touch");
      if (hand && shown(hand)) seen.set(hand, parseFloat(getComputedStyle(hand).opacity));
      return seen;
    };
    // And the touch glides: no faster than its drag, never a jump while it's showing.
    let lastAt: { x: number; y: number; o: number } | null = null;
    const touchAt = () => {
      const hand = document.getElementById("coach-touch");
      if (!hand || !shown(hand)) return null;
      const box = hand.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2, o: parseFloat(getComputedStyle(hand).opacity) };
    };
    const record = { fastest: 0, frames: 0, stop: false, glide: 0, touchFrames: 0 };
    (window as unknown as { smooth_: typeof record }).smooth_ = record;
    let last = sample(); // what's lit already is where it is
    let lastTime = 0;
    // Timed by the frame clock, the one the browser animates by.
    const watch = (time: number) => {
      if (record.stop) return;
      const seen = sample();
      const at = touchAt();
      if (at && lastAt && lastAt.o > 0.05 && at.o > 0.05 && time > lastTime) {
        record.glide = Math.max(record.glide, Math.hypot(at.x - lastAt.x, at.y - lastAt.y) / (time - lastTime));
        record.touchFrames++;
      }
      lastAt = at;
      if (lastTime && time > lastTime) {
        for (const el of new Set([...seen.keys(), ...last.keys()])) {
          if (!seen.has(el) && !shown(el)) continue; // went with its row or its screen
          // Not lit (never was, or taken away) counts as fully faded.
          const change = Math.abs((seen.get(el) ?? 0) - (last.get(el) ?? 0));
          record.fastest = Math.max(record.fastest, change / (time - lastTime));
        }
      }
      record.frames++;
      last = seen;
      lastTime = time;
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await page.waitForTimeout(4000); // pieces, lit in turn
  await searchByTyping(page);
  await afterTheShow(page); // the scrubber's touch, sliding with the histogram
  await scrubAt(page, await besideAWord(page));
  await expect(count(page)).toHaveText("3 of 5");
  await expect(page.locator('.line[data-tour-lit="on"]')).toHaveCount(1, { timeout: 5000 });
  await page.waitForTimeout(4500); // words, lit in turn

  // What it animates: opacity alone (the compositor's job), eased, never stepped.
  const animations = await page.evaluate(() =>
    document.getAnimations().flatMap((a) => {
      const effect = a.effect as KeyframeEffect | null;
      const target = effect?.target as Element | null;
      if (!effect?.pseudoElement || !target?.hasAttribute("data-tour-lit")) return [];
      const timing = effect.getComputedTiming();
      const properties = effect.getKeyframes().flatMap((k) => Object.keys(k)).filter((p) => !["offset", "computedOffset", "easing", "composite"].includes(p));
      return [{ properties: [...new Set(properties)], easing: (timing.easing ?? "") + " " + effect.getKeyframes().map((k) => k.easing).join(" "), duration: Number(timing.duration) }];
    }),
  );
  expect(animations.length).toBeGreaterThan(0);
  for (const a of animations) {
    expect(a.properties).toEqual(["opacity"]);
    expect(a.easing).not.toMatch(/steps|step-/);
    expect(a.duration).toBeGreaterThanOrEqual(200);
  }

  const record = await page.evaluate(() => {
    const r = (window as unknown as { smooth_: { fastest: number; frames: number; stop: boolean; glide: number; touchFrames: number } }).smooth_;
    r.stop = true;
    return r;
  });
  expect(record.frames).toBeGreaterThan(300); // it watched the whole way
  expect(record.fastest).toBeLessThan(0.009); // opacity per ms: a jump of 1 in one 16 ms frame would be 0.06
  expect(record.touchFrames).toBeGreaterThan(60); // it watched the touch slide
  expect(record.glide).toBeLessThan(1); // px per ms: its drag peaks near 0.4; a jump of 40 px in a frame would be 2.4
});

test("the scrubber shows itself: a touch slides with the histogram, the list follows, then all is as it was; again after 5 still seconds", { tag: "@release" }, async ({ page }) => {
  test.setTimeout(60_000 + LOAD_MS);
  await firstRun(page, "no-preference");
  // Watch every frame from the search on: the slider and its histogram, the touch, where
  // the list is, the step.
  await page.evaluate(() => {
    type Frame = { time: number; on: boolean; bar: number; touch: number | null; top: number; step: string };
    const frames: Frame[] = [];
    (window as unknown as { frames_: Frame[] }).frames_ = frames;
    const scroller = document.getElementById("scroller")!;
    const watch = (time: number) => {
      const hand = document.getElementById("coach-touch");
      const box = hand && !hand.hidden ? hand.getBoundingClientRect() : null;
      frames.push({
        time,
        on: !!document.querySelector(".slider.on"),
        bar: [...document.querySelectorAll(".slider-track i")].findIndex((bar) => bar.classList.contains("on")),
        touch: box && box.width ? Math.round(box.left + box.width / 2) : null,
        top: scroller.scrollTop,
        step: document.querySelector(".coach-count")?.textContent ?? "",
      });
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await searchByTyping(page);
  await afterTheShow(page);

  type Frame = { time: number; on: boolean; bar: number; touch: number | null; top: number; step: string };
  const frames = await page.evaluate(() => (window as unknown as { frames_: Frame[] }).frames_);
  const first = frames.findIndex((f) => f.on);
  const last = frames.length - 1 - [...frames].reverse().findIndex((f) => f.on);
  const open = frames.slice(first, last + 1);
  const before = frames[first - 1].top;
  // The touch was there, pressing, before the slider opened, and all the while it was open.
  expect(frames[first - 1].touch).not.toBeNull();
  expect(open.every((f) => f.touch !== null)).toBe(true);
  // Back and forth: out to one side, then home again.
  const start = open[0].touch!;
  expect(Math.min(...open.map((f) => f.touch!))).toBeLessThan(start - 60);
  expect(Math.abs(open.at(-1)!.touch! - start)).toBeLessThan(12);
  // In step with the histogram: its bar only moves on a frame where the touch moved.
  for (let i = 1; i < open.length; i++) {
    if (open[i].bar !== open[i - 1].bar) expect(open[i].touch).not.toBe(open[i - 1].touch);
  }
  expect(new Set(open.map((f) => f.bar)).size).toBeGreaterThan(1); // the piece moved
  expect(open.some((f) => f.top !== before)).toBe(true); // and the list with it
  expect(frames.at(-1)!.top).toBe(before); // and it's back where it was
  expect(frames.slice(first).every((f) => f.step === "2 of 5")).toBe(true); // the show isn't the person's go
  await expect(lit(page)).toHaveCount(0); // and no box beside a word in between

  // Not done within 5 still seconds: it shows again.
  const ended = frames.at(-1)!.time;
  await expect(page.locator(".slider")).toHaveClass(/\bon\b/, { timeout: 9000 });
  const again = await page.evaluate(() => performance.now());
  expect(again - ended).toBeGreaterThan(4500);
  await afterTheShow(page);

  // Then the person's go.
  await scrubAt(page, await besideAWord(page));
  await expect(count(page)).toHaveText("3 of 5");
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
  await expect(touch(page)).toBeHidden();
  await page.mouse.up();
  await page.waitForTimeout(3000);
  await expect(page.locator(".slider")).not.toHaveClass(/\bon\b/); // not again while the person's just been busy
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(before);
  await expect(count(page)).toHaveText("2 of 5");
});

test("a finger already on the list when the scrubber's show is due keeps it: no show, nothing put back", { tag: "@release" }, async ({ page }) => {
  await firstRun(page, "no-preference");
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { held_: string[] }).held_ = seen;
    const watch = () => {
      const hand = document.getElementById("coach-touch");
      if (hand && !hand.hidden) seen.push("touch"); // the show pressing
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await searchByTyping(page);
  // Straight away, before the show's moment: hold beside a word, and drag slowly, well past it.
  const at = await besideAWord(page);
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
  expect(await page.evaluate(() => (window as unknown as { held_: string[] }).held_)).toEqual([]); // no show
  await expect(count(page)).toHaveText("3 of 5"); // and the person's own go counted
});

test("the peek step lights whole words, see-through and borderless, in no particular order, each once before any again", { tag: "@release" }, async ({ page }) => {
  test.setTimeout(120_000 + LOAD_MS);
  await firstRun(page, "no-preference");
  await searchByTyping(page);
  await afterTheShow(page);

  // Which word is lit, frame by frame from the very first, and how well its highlight
  // covers it: the whole word (every letter, not only the piece), as much as the row shows.
  const recording = page.evaluate(async () => {
    const litLine = () => document.querySelector<HTMLElement>('.line[data-tour-lit="on"]');
    const waitUntil = performance.now() + 15_000;
    while (!litLine() && performance.now() < waitUntil) await new Promise(requestAnimationFrame);
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
    const seen: { row: string; covers: boolean; look: { border: string; background: string } }[] = [];
    const until = performance.now() + 2500 * (eligible.length + 2);
    while (performance.now() < until && seen.length < eligible.length + 2) {
      await new Promise(requestAnimationFrame);
      const line = litLine();
      const row = line?.closest<HTMLElement>("li.word");
      if (!line || !row || seen.at(-1)?.row === row.dataset.row) continue;
      const at = line.getBoundingClientRect();
      const s = getComputedStyle(line, "::before");
      const g = { left: at.left + parseFloat(s.left), top: at.top + parseFloat(s.top) };
      const box = { ...g, right: g.left + parseFloat(s.width), bottom: g.top + parseFloat(s.height) };
      const w = wordOf(row);
      seen.push({
        row: row.dataset.row!,
        covers: box.left <= w.left + 1 && box.right >= w.right - 1 && box.top <= w.top + 1 && box.bottom >= w.bottom - 1,
        look: { border: s.borderTopStyle === "none" || parseFloat(s.borderTopWidth) === 0 ? "none" : s.borderTopStyle, background: s.backgroundColor },
      });
    }
    return { eligible, seen };
  });
  await scrubAt(page, await besideAWord(page));
  await expect(count(page)).toHaveText("3 of 5");

  const hops = await recording;
  const order = hops.seen.map((h) => h.row);
  expect(hops.eligible.length).toBeGreaterThanOrEqual(6); // enough that an order means something
  expect(order.length).toBe(hops.eligible.length + 2);
  expect(hops.seen.every((h) => h.covers)).toBe(true); // the whole word, every time
  expect(hops.seen.every((h) => h.look.border === "none")).toBe(true); // no border
  for (const h of hops.seen) expect(h.look.background).toMatch(/rgba?\(.*,\s*0?\.\d+\)|color\(srgb .* \/ 0?\.\d+\)|oklab|color-mix/); // see-through
  const round = order.slice(0, hops.eligible.length);
  expect([...round].sort()).toEqual([...hops.eligible].sort()); // every word on screen, each once
  for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]); // never twice running
  const topToBottom = [...round].sort((a, b) => Number(a) - Number(b));
  expect(round).not.toEqual(topToBottom); // in no particular order
  expect(round).not.toEqual([...topToBottom].reverse());

  // Until the person holds one.
  await holdAt(page, await lightMiddle(page));
  await expect(count(page)).toHaveText("4 of 5", { timeout: 3000 });
  await expect(page.locator(".line[data-tour-lit]")).toHaveCount(0);
});

test("the tour stays out of the way: a tap on a lit word opens it, and Back brings the step back", async ({ page }) => {
  await firstRun(page);
  await toPeekStep(page);
  // The highlight takes no touch: what's under it does.
  const at = await lightMiddle(page);
  const label = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("li.word")?.getAttribute("aria-label"), at);
  expect(label).toBeTruthy();
  await page.mouse.click(at.x, at.y);
  await expect(page.locator("#entry")).toBeVisible();
  await expect(page.locator("#entry")).toContainText(label!);
  await expect(lit(page)).toHaveCount(0); // nothing lit on a word's page
  await expect(card(page)).toBeHidden();
  await page.goBack();
  await expect(page.locator("#frame")).toBeVisible();
  await expect(count(page)).toHaveText("3 of 5");
  await expect(page.locator('.line[data-tour-lit="on"]')).toHaveCount(1);
});

test("Skip ends the tour for good, and leaves nothing behind", async ({ page }) => {
  await firstRun(page, "no-preference");
  await toPeekStep(page, "no-preference");
  await expect(lit(page)).toHaveCount(1);
  await card(page).getByRole("button", { name: "Skip" }).click();
  await expect(card(page)).toBeHidden();
  await expect(page.locator("[data-tour-lit]")).toHaveCount(0); // faded, then gone
  await page.waitForTimeout(2500);
  await expect(page.locator("[data-tour-lit]")).toHaveCount(0);
  expect(await tourAnimations(page)).toBe(0);
  expect(await page.locator("#scroller .line").evaluateAll((lines) => lines.filter((l) => (l as HTMLElement).style.position).length)).toBe(0);
  await page.reload();
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/, { timeout: LOAD_MS });
  await expect(card(page)).toBeHidden();
  await page.locator("#q").fill("ate");
  await page.waitForTimeout(1500);
  await expect(page.locator(".slider")).not.toHaveClass(/\bon\b/); // no show either
  await expect(page.locator("[data-tour-lit]")).toHaveCount(0);
});

test("the note is never a wall, and never covers what a step is about", async ({ page }) => {
  await firstRun(page);
  const view = page.viewportSize()!;
  const note = async () => (await card(page).boundingBox())!;
  // 1: the pieces.
  const pieces = (await page.locator("#examples").boundingBox())!;
  expect((await note()).y + (await note()).height).toBeLessThanOrEqual(pieces.y);
  await page.locator("#examples button.tile").first().click();
  // 2: the touch beside a word.
  await expect(touch(page)).toBeVisible({ timeout: 10_000 });
  expect((await note()).height).toBeLessThan(view.height / 3);
  const hand = (await touch(page).boundingBox())!;
  expect(hand.y + hand.height).toBeLessThanOrEqual((await note()).y);
  await scrubAt(page, await middle(page, "#coach-touch"));
  // 3: the lit word.
  await expect(page.locator('.line[data-tour-lit="on"]')).toHaveCount(1);
  expect((await lightBox(page)).bottom).toBeLessThanOrEqual((await note()).y);
});

test("the start screen has no guide text of its own: the tour says it", async ({ page }) => {
  await page.context().addInitScript(() => localStorage.setItem("dictionarius.tour", "done"));
  await firstRun(page);
  await expect(page.locator("#intro")).not.toContainText("pick one");
  await expect(page.locator(".bag-label")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Pieces to search for" })).toBeVisible();
});

test("the ? beside the cog shows How It Works, and Show me again starts the tour over from anywhere, filters cleared", async ({ page }) => {
  await page.context().addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) localStorage.setItem("dictionarius.tour", "done");
    sessionStorage.setItem("seeded", "1");
  });
  await firstRun(page);
  const help = page.locator("#help-open");
  const cog = page.locator("#settings-open");
  expect((await help.boundingBox())!.x).toBeLessThan((await cog.boundingBox())!.x); // to the left of the cog
  await expect(help).toHaveAccessibleName("How It Works");

  // From the word list, not the start screen, with a word length set.
  await page.locator("#q").fill("ate");
  await page.locator("#q").blur();
  await expect(page.locator("#frame")).toBeVisible();
  await page.locator("#filters-open").click();
  await page.getByRole("spinbutton", { name: "Minimum word length" }).focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowUp");
  await page.locator("#filters").getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#filters-open")).toHaveAttribute("data-active", "");
  await help.click();
  const sheet = page.locator("#help");
  await expect(sheet.getByRole("heading")).toHaveText("How It Works");
  await expect(sheet.locator("dt")).toHaveText([
    "Tap a piece",
    "Tap a word",
    "Hold a word",
    "Hold beside a word, then slide",
    "Tap the funnel",
    "Tap the cog",
    "Back",
  ]);
  await expect(sheet.locator("dd")).toHaveText([
    "to find every word containing it",
    "to open its full entry",
    "to peek at its meaning",
    "to move where the piece lands mid-word",
    "to filter words by length",
    "to choose what the list shows, like safe search",
    "returns you to your list, right where you left it",
  ]);
  await sheet.getByRole("button", { name: "Show me again" }).click();
  await expect(sheet).toBeHidden();
  // Back to the start screen, where the tour begins, the first step showing.
  await expect(page.locator("#intro")).toBeVisible();
  await expect(count(page)).toHaveText("1 of 5");
  await expect(page.locator("#examples [data-tour-lit]")).toHaveCount(1);
  await expect(page.locator("#q")).toHaveValue("");
  // And it starts with no filters: the list it opens is every word.
  await expect(page.locator("#filters-open")).not.toHaveAttribute("data-active", "");
  await page.locator("#filters-open").click();
  await expect(page.getByRole("spinbutton", { name: "Minimum word length" })).toHaveAttribute("aria-valuetext", "Any");
});
