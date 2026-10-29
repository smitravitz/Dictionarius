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
    "A made-up bar of cast metal.",
    /archaic.*in old ledgers.*A made-up sub-meaning\./,
    /transitive.*To cast into made-up bars\./,
  ]);
  // One origin for both: shown once, before the classes it belongs to.
  await expect(entry(page).locator(".etymology")).toHaveText(["From a made-up Middle English word."]);
  await expect(entry(page).locator(".entry-note")).toBeHidden();
  await expect(page.locator("#entry-link")).toHaveAttribute("href", "https://en.wiktionary.org/wiki/ingot");
});

test("a plural links to its word", async ({ page }) => {
  await open(page);
  await openWord(page, "zorbles", "zorbles");
  await entry(page).getByRole("button", { name: "zorble" }).click();
  await expect(page.locator("#entry-word")).toHaveText("zorble");
  await expect(entry(page).locator(".meanings > li")).toHaveText(["to wobble (made up)"]);
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

test("a word without definitions says so, and still links to Wiktionary", async ({ page }) => {
  await open(page);
  await openWord(page, "resume", "resume");
  await expect(entry(page).locator(".entry-note")).toHaveText("No definition for this word in the app yet.");
  await expect(page.locator("#entry-link")).toBeVisible();
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
