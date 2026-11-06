import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { HeadwordIndex } from "../src/headword-index";
import { DefinitionsFile, LAYERS } from "../src/definitions";
import { Completer } from "../src/complete";
import { Filters, defaultFilters } from "../src/filters";
import { parseSafeSearchList } from "../src/safe-search-list";
import { entryView, type EntryView } from "../src/entry-view";
import { asTheApp } from "./as-the-app";

// Words picked at random (a new pick each run; the seed is in the report), each opened
// as a user would, must show every part of their page their data calls for: the word,
// each word class in order, every meaning with its gloss, the pronunciation, origin and
// examples when they have them, and no note (save safe search's). In a browser and in
// the app (which reads in place). The data is the fixture, or a real word list:
//   DICTIONARIUS_SAMPLE_DATA=release-data npx playwright test e2e/word-page-sample.spec.ts
// (the release workflow does that before publishing).

const DATA = process.env.DICTIONARIUS_SAMPLE_DATA ?? "test/fixtures";
const BASE = existsSync(`${DATA}/headwords.bin`) ? "headwords" : "headwords-sample";
const SIZE = Number(process.env.SAMPLE_SIZE ?? 12);
const SEED = Number(process.env.SAMPLE_SEED ?? Math.floor(Math.random() * 2 ** 31));
const SAFE_SEARCH_OVERRIDES = parseSafeSearchList(readFileSync("data/safe-search.list", "utf8"));

interface Sampled {
  key: string;
  display: string;
  view: EntryView;
}

/** Up to SIZE words a default search shows, with definitions, that Enter opens. */
async function sample(): Promise<Sampled[]> {
  const read = (name: string) => new Uint8Array(readFileSync(`${DATA}/${BASE}.${name}`));
  const index = HeadwordIndex.fromBytes(read("bin"));
  const definitions = DefinitionsFile.fromBytes(read("definitions.bin"), index,
    Object.fromEntries(LAYERS.map((kind) => [kind, read(`${kind}.bin`)])));
  const hidden = new Filters({ index, overrides: SAFE_SEARCH_OVERRIDES }).compile(defaultFilters());
  const completer = new Completer(index, SAFE_SEARCH_OVERRIDES);
  let state = SEED; // mulberry32: the same seed picks the same words
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  // Every word, shuffled, for a small list (the fixture: 14 of 17,082 have definitions);
  // random draws for a real one, where nearly every word has them.
  const small = index.size <= 100_000;
  const order = small ? Array.from({ length: index.size }, (_, i) => i) : [];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const picked: Sampled[] = [];
  const tried = new Set<number>();
  for (let n = 0; picked.length < SIZE && (small ? n < order.length : n < 100 * SIZE); n++) {
    const id = small ? order[n] : Math.floor(random() * index.size);
    if (tried.has(id)) continue;
    tried.add(id);
    if (hidden?.has(id)) continue;
    const key = index.key(id);
    const opens = completer.word(key);
    const defs = await definitions.of(id);
    if (!defs || opens?.id !== id) continue;
    const view = entryView(defs, { safe: true });
    if (view.classes.length) picked.push({ key, display: opens.display, view });
  }
  return picked;
}

async function expectWholePage(page: Page, { key, display, view }: Sampled) {
  const tag = `${key} (seed ${SEED})`;
  await page.locator("#q").fill(key);
  await page.locator("#q").press("Enter");
  const entry = page.locator("#entry");
  await expect(page.locator("#entry-word"), tag).toHaveText(display);
  await expect(entry.locator(".word-class-name"), tag).toHaveText(view.classes.map((c) => c.pos));
  await expect(entry.locator(".entry-note"), tag).toBeHidden({ visible: view.hidden === 0 } as never).catch(() => {});
  if (view.hidden) await expect(entry.locator(".entry-note"), tag).toContainText("hidden by safe search");
  else await expect(entry.locator(".entry-note"), tag).toBeHidden();
  for (const [i, c] of view.classes.entries()) {
    const meanings = entry.locator(".word-class").nth(i).locator(".meaning");
    await expect(meanings, `${tag}: ${c.pos}'s meanings`).toHaveCount(c.meanings.length);
    const glosses = await meanings.locator(".gloss").allTextContents();
    expect(glosses.filter((g) => !g.trim()), `${tag}: a meaning without its gloss`).toEqual([]);
  }
  await expect(entry.locator(".entry-ipa"), `${tag}: pronunciation`).toHaveCount(view.ipa.length ? 1 : 0);
  await expect(entry.locator(".entry-origin"), `${tag}: origin`).toHaveCount(view.origin ? 1 : 0);
  const examples = view.classes.flatMap((c) => c.meanings).filter((m) => m.example).length;
  await expect(entry.locator(".example"), `${tag}: examples`).toHaveCount(examples);
  await page.goBack();
}

for (const where of ["in a browser", "in the app"] as const) {
  test(`randomly picked words show every part of their page, ${where}`, async ({ page }) => {
    test.setTimeout(30_000 + SIZE * 5_000);
    const words = await sample();
    test.info().annotations.push({ type: "sample", description: `seed ${SEED} (${DATA}): ${words.map((w) => w.key).join(", ")}` });
    expect(words.length, `no words to pick from in ${DATA}`).toBeGreaterThan(0);
    if (where === "in the app") await asTheApp(page);
    await page.goto(`/?index=${BASE}.bin`);
    await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/, { timeout: 60_000 });
    await expect(page.locator("#loader")).toHaveCount(0, { timeout: 120_000 });
    for (const word of words) await expectWholePage(page, word);
  });
}
