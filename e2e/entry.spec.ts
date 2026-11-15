import { test, expect, type Locator, type Page } from "@playwright/test";
import { asTheApp } from "./as-the-app";

// A word's entry and its peek, on the fixture's made-up definitions:
// "ingot" (noun with a pronunciation and origin, then verb), "zorbles" (plural
// of "zorble"), "turkeyword" and "Turkeyword" (one search key, two written
// forms), "gapword" (an everyday meaning, then a slur). Words from the plain
// word list, such as "resume", have no definitions.

async function open(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await expect(page.locator("#loader")).toHaveCount(0); // a browser shows the app once all is in
}

/** Search for `query` and tap the row showing `word`. */
async function openWord(page: Page, query: string, word: string) {
  await page.locator("#q").fill(query);
  await page.locator(`li.word[aria-label="${word}"]`).click();
  await expect(page.locator("#entry-word")).toHaveText(word);
}

const entry = (page: Page) => page.locator("#entry");

test("tapping a word shows its definitions: word classes, numbered meanings, labels, pronunciation, origin", async ({ page }) => {
  await open(page);
  await openWord(page, "ingot", "ingot");
  await expect(entry(page).locator(".entry-ipa")).toHaveText("/ˈɪŋ.ɡət/");
  await expect(entry(page).locator(".word-class-name")).toHaveText(["noun", "verb"]);
  const meanings = entry(page).locator(".meanings > li");
  await expect(meanings).toHaveText([
    /^A made-up bar of cast metal\./,
    /archaic.*in old ledgers.*A made-up sub-meaning\./,
    /transitive.*To cast into made-up bars\./,
  ]);
  // One origin for both: a brief at the top, short enough to need no "more".
  await expect(entry(page).locator(".entry-origin")).toHaveText("From a made-up Middle English word.");
  await expect(entry(page).locator(".clamp-toggle")).toHaveCount(2);
  await expect(entry(page).locator(".clamp-toggle:visible")).toHaveCount(0);
  await expect(entry(page).locator(".entry-note")).toBeHidden();
});

test("a meaning's example of use follows its definition", async ({ page }) => {
  await open(page);
  await openWord(page, "ingot", "ingot");
  const first = entry(page).locator(".meanings > li").first();
  await expect(first.locator(".example")).toHaveText("He weighed the made-up ingot.");
  // Under the definition, not beside it.
  const gloss = (await first.locator(".gloss").boundingBox())!;
  const example = (await first.locator(".example").boundingBox())!;
  expect(example.y).toBeGreaterThanOrEqual(gloss.y + gloss.height - 1);
  await expect(entry(page).locator(".example")).toHaveCount(1); // the others have none
});

test("without the examples file, a word's page still has its meanings and origin, just no examples", async ({ page }) => {
  // An app built without the examples layer (ADR-0005): everything else still shows.
  await page.context().route((url) => url.pathname.endsWith("/headwords-sample.examples.bin"), (route) => route.fulfill({ status: 404 }));
  await open(page);
  await openWord(page, "ingot", "ingot");
  await expect(entry(page).locator(".meanings > li").first().locator(".gloss")).toBeVisible();
  await expect(entry(page).locator(".entry-origin")).toHaveText("From a made-up Middle English word.");
  await expect(entry(page).locator(".example")).toHaveCount(0);
});

test("a word's page appears whole: its meanings are there the moment it shows", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("ingot");
  // Note what the page holds at the instant it's shown.
  await page.evaluate(() => {
    const entry = document.getElementById("entry")!;
    new MutationObserver(() => {
      if (!entry.hidden) (window as any).shownWith ??= entry.querySelectorAll(".meaning").length;
    }).observe(entry, { attributes: true, attributeFilter: ["hidden"] });
  });
  await page.locator('li.word[aria-label="ingot"]').click();
  await expect(page.locator("#entry-word")).toHaveText("ingot");
  expect(await page.evaluate(() => (window as any).shownWith)).toBe(3);
});

test("no link out on the page; the footer's credit names the open word's Wiktionary page", async ({ page }) => {
  await open(page);
  await expect(page.locator("#source")).toHaveAttribute("href", "https://en.wiktionary.org");
  await openWord(page, "ingot", "ingot");
  await expect(entry(page).locator("a")).toHaveCount(0);
  await expect(page.locator("#source")).toHaveAttribute("href", "https://en.wiktionary.org/wiki/ingot");
  await page.goBack();
  await expect(page.locator("#source")).toHaveAttribute("href", "https://en.wiktionary.org");
});

test("a browser shows the loading screen until its starter is in, then nothing says loading", async ({ page }) => {
  // The starter (src/starter.ts) is what the app shows from; the word list and the
  // definitions come behind it, so the loading screen waits for the starter alone.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.context().route((url) => url.pathname.endsWith(".starter.json"), async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/?index=headwords-sample.bin");
  const loader = page.locator("#loader");
  await expect(loader).toContainText("Loading Dictionarius");
  expect(await dotsOverTime(loader.locator(".dots"))).toEqual(expect.arrayContaining([1, 2, 3])); // the dots come and go
  await expect(loader).toBeVisible();
  expect(await page.locator("#app").evaluate((app) => (app as HTMLElement).inert)).toBe(true);
  release();
  await expect(loader).toHaveCount(0);
  await openWord(page, "ingot", "ingot");
  await expect(entry(page).locator(".meaning")).toHaveCount(3);
  await expect(entry(page).locator(".entry-note")).toBeHidden();
});

/** How many of a "still working" line's dots show, each animation frame for two seconds:
 *  the dots come one, two, three, and back (". .. ... .."). */
function dotsOverTime(dots: Locator): Promise<number[]> {
  return dots.evaluate(
    (el) =>
      new Promise<number[]>((resolve) => {
        const seen: number[] = [];
        const start = performance.now();
        const frame = (now: number) => {
          seen.push([...el.children].filter((dot) => Number(getComputedStyle(dot).opacity) > 0.5).length);
          if (now - start < 2000) requestAnimationFrame(frame);
          else resolve(seen);
        };
        requestAnimationFrame(frame);
      }),
  );
}

/** Holds back the definitions (the file and its layers) until `release` is called. */
async function holdDefinitions(page: Page) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.context().route(
    (url) => /\.(definitions|examples|etymology|pronunciation)\.bin$/.test(url.pathname),
    async (route) => {
      await held;
      await route.continue().catch(() => {});
    },
  );
  return release;
}

test("a word whose definitions are still downloading says so, the dots coming and going, the line holding still", async ({
  page,
}) => {
  const release = await holdDefinitions(page);
  await open(page);
  await page.locator("#q").fill("ingot");
  await page.locator('li.word[aria-label="ingot"]').click();
  // The page turns at once, with the word; past a moment, it says the rest is on its way.
  await expect(page.locator("#entry-word")).toHaveText("ingot");
  const note = entry(page).locator(".entry-note");
  await expect(note).toHaveText(/^Still downloading/);
  const dots = note.locator(".dots");
  await expect(dots).toHaveAttribute("aria-hidden", "true"); // read out once, not dot by dot
  // Each step of ". .. ... .." seen, in a line whose width never changes as they come and go.
  const widthBefore = (await note.locator(".still").boundingBox())!.width;
  const seen = await dotsOverTime(dots);
  expect(seen).toEqual(expect.arrayContaining([1, 2, 3]));
  expect(seen.filter((n) => n < 1 || n > 3)).toEqual([]);
  expect((await note.locator(".still").boundingBox())!.width).toBeCloseTo(widthBefore, 2);
  // In: the meanings, and nothing says downloading any more.
  release();
  await expect(entry(page).locator(".meaning")).toHaveCount(3);
  await expect(note).toBeHidden();
});

test("with reduced motion, the dots hold still: all three", async ({ page }) => {
  const release = await holdDefinitions(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await page.locator("#q").fill("ingot");
  await page.locator('li.word[aria-label="ingot"]').click();
  const dots = entry(page).locator(".entry-note .dots");
  await expect(dots).toBeVisible();
  expect(new Set(await dotsOverTime(dots))).toEqual(new Set([3]));
  release();
});

/** A phone's network, for the definitions (the file and its layers): `answer` decides each
 *  request: through, lost on the way, or held (no answer, as from a network that's gone).
 *  `range` is the Range asked for; null for the whole file. */
async function definitionsNetwork(page: Page, answer: (range: string | null) => "through" | "lost" | "held") {
  await page.context().route(
    (url) => /\.(definitions|examples|etymology|pronunciation)\.bin$/.test(url.pathname),
    async (route) => {
      const what = answer(route.request().headers()["range"] ?? null);
      if (what === "lost") return route.abort("internetdisconnected");
      if (what === "through") return route.continue().catch(() => {});
    },
  );
}
// The whole file (34 MB on the real data) would take minutes on a phone's network, and so does
// the background save that downloads it: held, so a word's page can't be waiting on it.
const wholeFileHeld = (range: string | null) => range === null;

test("a request for a word's definitions lost on the way is asked again: they come, without downloading the whole file", async ({
  page,
}) => {
  let armed = false;
  let lost = 0;
  await definitionsNetwork(page, (range) => (wholeFileHeld(range) ? "held" : armed && lost++ === 0 ? "lost" : "through"));
  await open(page);
  armed = true;
  await openWord(page, "ingot", "ingot");
  await expect(entry(page).locator(".meaning")).toHaveCount(3);
  expect(lost).toBeGreaterThan(0);
});

// A short note: the bar under the title says how the download and the connection are doing.
const NO_SIGNAL = /^Waiting for a connection\.*$/;

test("with no signal, a word's page says its definitions couldn't be downloaded, then shows them once the signal's back", async ({
  page,
}) => {
  let signal = true;
  await definitionsNetwork(page, (range) => (wholeFileHeld(range) ? "held" : signal ? "through" : "lost"));
  await open(page);
  signal = false;
  await openWord(page, "ingot", "ingot");
  const note = entry(page).locator(".entry-note");
  await expect(note).toHaveText(NO_SIGNAL);
  signal = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online"))); // the browser says it's back
  await expect(entry(page).locator(".meaning")).toHaveCount(3);
  await expect(note).toBeHidden();
});

test("opened with no signal, the definitions come once it's back, not 'no definition' for the rest of the visit", async ({ page }) => {
  let signal = false;
  await definitionsNetwork(page, (range) => (wholeFileHeld(range) ? "held" : signal ? "through" : "lost"));
  await open(page);
  await openWord(page, "ingot", "ingot");
  await expect(entry(page).locator(".entry-note")).toHaveText(NO_SIGNAL);
  signal = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(entry(page).locator(".meaning")).toHaveCount(3);
});

test("with no signal, held on a word, the peek says its definitions couldn't be downloaded", async ({ page }) => {
  let signal = true;
  await definitionsNetwork(page, (range) => (wholeFileHeld(range) ? "held" : signal ? "through" : "lost"));
  await open(page);
  signal = false;
  await page.locator("#q").fill("ingot");
  await page.locator("#q").blur();
  const box = (await page.locator('li.word[aria-label="ingot"] .frag').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator("#peek")).toContainText("Waiting for a connection.");
  await page.mouse.up();
});

test("the Android app, which downloads nothing, says its definitions are still loading", async ({ page }) => {
  await asTheApp(page);
  const release = await holdDefinitions(page);
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await page.locator("#q").fill("ingot");
  await page.locator('li.word[aria-label="ingot"]').click();
  await expect(entry(page).locator(".entry-note")).toHaveText(/^Still loading/);
  release();
  await expect(entry(page).locator(".meaning")).toHaveCount(3);
});

/** How many lines of text an element shows. */
const lines = (page: Page, selector: string) =>
  entry(page)
    .locator(selector)
    .evaluate((e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)));

test("a long list of pronunciations shows two lines, the rest behind more", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 }); // a phone's width: twelve don't fit in two lines
  await open(page);
  await openWord(page, "zorble", "zorble");
  expect(await lines(page, ".entry-ipa")).toBe(2);
  const toggle = entry(page).locator(".entry-ipa + .clamp-toggle");
  await expect(toggle).toHaveText("more");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  expect(await lines(page, ".entry-ipa")).toBeGreaterThan(2);
  await expect(toggle).toHaveText("less");
  await toggle.click();
  expect(await lines(page, ".entry-ipa")).toBe(2);
  // Wide enough for all of them: nothing to unfold.
  await page.setViewportSize({ width: 1600, height: 800 });
  await expect(toggle).toBeHidden();
});

test("a long origin brief shows three lines, the rest behind more", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page);
  await openWord(page, "zorble", "zorble");
  expect(await lines(page, ".entry-origin")).toBe(3);
  await entry(page).locator(".entry-origin + .clamp-toggle").click();
  expect(await lines(page, ".entry-origin")).toBeGreaterThan(3);
  await expect(entry(page).locator(".entry-origin")).toContainText("made-up ledgers.");
});

test("a word with several origins has no brief", async ({ page }) => {
  await open(page);
  await openWord(page, "turkeyword", "turkeyword");
  await expect(entry(page).locator(".word-class-name")).toHaveText(["noun", "proper noun"]);
  await expect(entry(page).locator(".entry-origin")).toHaveCount(0);
});

test("a plural links to its word", async ({ page }) => {
  await open(page);
  await openWord(page, "zorbles", "zorbles");
  await entry(page).getByRole("button", { name: "zorble" }).click();
  await expect(page.locator("#entry-word")).toHaveText("zorble");
  await expect(entry(page).locator(".meanings > li .gloss")).toHaveText(["to wobble (made up)"]);
});

test("every written form of a word is there, the most common first", async ({ page }) => {
  await open(page);
  await openWord(page, "turkeyword", "turkeyword");
  await expect(entry(page).locator(".word-class-name")).toHaveText(["noun", "proper noun"]);
  await expect(entry(page).locator(".word-class-form")).toHaveText(["", "Turkeyword"]); // named only where it differs
});

test("safe search leaves a shown word's vulgar or offensive meanings out, and says how many", async ({ page }) => {
  await open(page);
  await openWord(page, "gapword", "gapword");
  await expect(entry(page).locator(".meanings > li")).toHaveText(["an everyday meaning"]);
  await expect(entry(page).locator(".entry-note")).toHaveText("1 meaning hidden by safe search.");
});

test("a word without definitions says so", async ({ page }) => {
  await open(page);
  await openWord(page, "resume", "resume");
  await expect(entry(page).locator(".entry-note")).toHaveText("No definition for this word in the app yet.");
});

test("holding a word peeks at its first meanings until it's let go, without opening it", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("ingot");
  await page.locator("#q").blur();
  const word = page.locator('li.word[aria-label="ingot"] .frag');
  const box = (await word.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const peek = page.locator("#peek");
  await expect(peek).toBeVisible();
  await expect(peek.locator(".word-class-name")).toHaveText("noun");
  await expect(peek.locator(".meanings > li")).toHaveText(["A made-up bar of cast metal.", /A made-up sub-meaning\./]);
  await expect(peek.locator(".peek-more")).toHaveText("+ 1 more · tap the word for all");
  await page.mouse.up();
  await expect(peek).toBeHidden();
  await expect(entry(page)).toBeHidden();
});

test("holding between two rows peeks the nearer word, not the position slider", async ({ page }) => {
  await open(page);
  await page.locator("#q").fill("ingot");
  await page.locator("#q").blur();
  const row = page.locator('li.word[aria-label="ingot"]');
  const letters = (await row.locator(".frag").boundingBox())!;
  const box = (await row.boundingBox())!;
  // The row's bottom edge: well below its letters, in the gap before the next row.
  await page.mouse.move(letters.x + letters.width / 2, box.y + box.height - 3);
  await page.mouse.down();
  const peek = page.locator("#peek");
  await expect(peek).toBeVisible();
  await expect(peek.locator(".word-class-name")).toHaveText("noun"); // ingot's
  await expect(page.locator(".slider")).not.toHaveClass(/\bon\b/);
  await page.mouse.up();
  await expect(peek).toBeHidden();
});

/** A quick flick across the middle of the screen: "right" steps back, "left" forward. */
async function swipe(page: Page, direction: "left" | "right") {
  const { width, height } = page.viewportSize()!;
  const cdp = await page.context().newCDPSession(page);
  const y = Math.round(height * 0.6);
  const [from, to] = direction === "right" ? [0.25, 0.75] : [0.75, 0.25];
  const steps = 5;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: Math.round(width * from), y }] });
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(width * (from + ((to - from) * i) / steps));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** zorbles → its link "zorble" → its link "wobble": three words followed. */
async function followThree(page: Page) {
  await open(page);
  await openWord(page, "zorbles", "zorbles");
  await entry(page).getByRole("button", { name: "zorble" }).click();
  await expect(page.locator("#entry-word")).toHaveText("zorble");
  await entry(page).getByRole("button", { name: "wobble" }).click();
  await expect(page.locator("#entry-word")).toHaveText("wobble");
}

test("swiping steps back and forward along the words followed, back to the results", async ({ page, isMobile, browserName }) => {
  test.skip(!isMobile, "touch swipes on the phone project");
  test.skip(browserName !== "chromium", "the swipe is sent through Chromium's devtools");
  await followThree(page);
  const word = page.locator("#entry-word");
  await swipe(page, "right");
  await expect(word).toHaveText("zorble");
  await swipe(page, "right");
  await expect(word).toHaveText("zorbles");
  await swipe(page, "left");
  await expect(word).toHaveText("zorble");
  await swipe(page, "left");
  await expect(word).toHaveText("wobble");
  await swipe(page, "left"); // nothing further on
  await expect(word).toHaveText("wobble");
  for (let i = 0; i < 3; i++) await swipe(page, "right");
  await expect(entry(page)).toBeHidden();
  await expect(page.locator("li.word").first()).toBeVisible(); // the results, as they were
  await expect(page.locator("#q")).toHaveValue("zorbles");
});

test("Back goes straight to the results; a swipe forward takes up the same words again", async ({ page, isMobile, browserName }) => {
  test.skip(!isMobile, "touch swipes on the phone project");
  test.skip(browserName !== "chromium", "the swipe is sent through Chromium's devtools");
  await followThree(page);
  await page.goBack();
  await expect(entry(page)).toBeHidden();
  await expect(page.locator("li.word").first()).toBeVisible();
  await swipe(page, "left");
  await expect(page.locator("#entry-word")).toHaveText("zorbles");
  await swipe(page, "left");
  await expect(page.locator("#entry-word")).toHaveText("zorble");
  // Back again goes to the results, and a new search forgets the words.
  await page.goBack();
  await expect(entry(page)).toBeHidden();
  await page.locator("#q").fill("ingot");
  await expect(page.locator('li.word[aria-label="ingot"]')).toBeVisible();
  await swipe(page, "left");
  await expect(entry(page)).toBeHidden();
});

test("the browser's Back goes to the results in one step, and Forward to the first word followed", async ({ page }) => {
  await followThree(page);
  await page.goBack();
  await expect(entry(page)).toBeHidden();
  await expect(page.locator("#q")).toHaveValue("zorbles");
  await page.goForward();
  await expect(page.locator("#entry-word")).toHaveText("zorbles");
});
