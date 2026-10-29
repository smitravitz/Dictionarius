import { test, expect, type Page } from "@playwright/test";

// A word's entry and its peek, on the fixture's made-up definitions:
// "ingot" (noun with a pronunciation and origin, then verb), "zorbles" (plural
// of "zorble"), "turkeyword" and "Turkeyword" (one search key, two written
// forms), "gapword" (an everyday meaning, then a slur). Words from the plain
// word list, such as "resume", have no definitions.

async function open(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
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

test("while the definitions are still loading, the page says so, then fills in", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.context().route("**/headwords-sample.definitions.bin", async (route) => {
    await held;
    await route.continue();
  });
  await open(page);
  await openWord(page, "ingot", "ingot");
  await expect(entry(page).locator(".entry-note")).toHaveText("Loading the definitions…");
  await expect(entry(page).locator(".meaning")).toHaveCount(0);
  release();
  await expect(entry(page).locator(".meaning")).toHaveCount(3);
  await expect(entry(page).locator(".entry-note")).toBeHidden();
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
