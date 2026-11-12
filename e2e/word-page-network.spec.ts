import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { HeadwordIndex } from "../src/headword-index";
import { DefinitionsFile, LAYERS } from "../src/definitions";
import { Completer } from "../src/complete";
import { entryView } from "../src/entry-view";
import { parseSafeSearchList } from "../src/safe-search-list";

// A word's page on a phone's network, before the dictionary is saved on the device: each
// part of the page comes from a file of its own, read over the network a block at a time.
// Whichever file is slow, lost on the way or gets no answer at all, every painted frame of
// the page shows either the word with "Still downloading", the word with "no connection",
// or the whole page: never one part without another, never a part arriving late, and
// never a page left waiting for good. Checked frame by frame, for each file on its own and
// for all of them. On the fixture here, and on the real word list before every release
// and every Pages deploy (release.yml, pages.yml):
//   DICTIONARIUS_SAMPLE_DATA=release-data npx playwright test e2e/word-page-network.spec.ts

const DATA = process.env.DICTIONARIUS_SAMPLE_DATA ?? "test/fixtures";
const BASE = existsSync(`${DATA}/headwords.bin`) ? "headwords" : "headwords-sample";

/** The file each part of a word's page comes from. */
const FILES = {
  definitions: "its word classes and meanings",
  examples: "its examples",
  etymology: "its origin",
  pronunciation: "its pronunciation",
} as const;
type File = keyof typeof FILES;
const ALL = Object.keys(FILES) as File[];
const DATA_FILE = /\.(definitions|examples|etymology|pronunciation)\.bin$/;

/** What a frame of the word's page shows. */
interface Frame {
  word: string;
  forms: string;
  note: string;
  ipa: number;
  origin: number;
  classes: number;
  meanings: number;
  glosses: number;
  examples: number;
  text: number; // the page's text, all parts together, in characters
}

/** A word with every part: pronunciation, origin, word classes, meanings and examples,
 *  not hidden by safe search, opened by Enter. Its page as the data says it is. */
const word = (() => {
  const read = (name: string) => new Uint8Array(readFileSync(`${DATA}/${BASE}.${name}`));
  const index = HeadwordIndex.fromBytes(read("bin"));
  const definitions = DefinitionsFile.fromBytes(read("definitions.bin"), index, Object.fromEntries(LAYERS.map((k) => [k, read(`${k}.bin`)])));
  const completer = new Completer(index, parseSafeSearchList(readFileSync("data/safe-search.list", "utf8")));
  return async () => {
    for (let id = 0; id < Math.min(index.size, 2_000_000); id++) {
      const defs = await definitions.of(id);
      if (!defs) continue;
      const view = entryView(defs, { safe: true });
      const meanings = view.classes.flatMap((c) => c.meanings);
      if (!view.ipa.length || !view.origin || view.hidden || !meanings.some((m) => m.example)) continue;
      const key = index.key(id);
      const opens = completer.word(key);
      if (opens?.id !== id) continue;
      return {
        key,
        display: opens.display,
        whole: { ipa: 1, origin: 1, classes: view.classes.length, meanings: meanings.length, glosses: meanings.length, examples: meanings.filter((m) => m.example).length },
      };
    }
    throw new Error(`no word with every part in ${DATA}`);
  };
})();

/** Records what the word's page shows in every painted frame, from the first. */
async function recordFrames(page: Page) {
  await page.addInitScript(() => {
    const frames: string[] = [];
    (window as unknown as { entryFrames: string[] }).entryFrames = frames;
    const count = (root: Element, selector: string) => root.querySelectorAll(selector).length;
    const look = () => {
      const entry = document.getElementById("entry");
      if (entry && !entry.hidden) {
        const note = document.getElementById("entry-note")!;
        const body = document.getElementById("entry-body")!;
        const frame = JSON.stringify({
          word: document.getElementById("entry-word")!.textContent,
          forms: document.getElementById("entry-forms")!.textContent,
          note: note.hidden ? "" : (note.textContent ?? "").replace(/[.\s]+$/, ""), // the dots come and go
          ipa: count(body, ".entry-ipa"),
          origin: count(body, ".entry-origin"),
          classes: count(body, ".word-class"),
          meanings: count(body, ".meaning"),
          glosses: count(body, ".gloss"),
          examples: count(body, ".example"),
          text: (body.textContent ?? "").length,
        });
        if (frames.at(-1) !== frame) frames.push(frame);
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}
const framesOf = async (page: Page) =>
  (await page.evaluate(() => (window as unknown as { entryFrames: string[] }).entryFrames)).map((f) => JSON.parse(f) as Frame);

/** The network for the data files. `slow`, `lost` and `dead` say which files are, now;
 *  the others answer at once. The whole of a file (what the save on the device downloads)
 *  never comes: the dictionary isn't saved yet, so every part is read over the network. */
function network(page: Page) {
  const state = { slow: [] as File[], slowMs: 1500, lost: [] as File[], dead: [] as File[], asked: Object.fromEntries(ALL.map((f) => [f, 0])) as Record<File, number> };
  const ready = page.context().route(
    (url) => DATA_FILE.test(url.pathname),
    async (route) => {
      const file = DATA_FILE.exec(new URL(route.request().url()).pathname)![1] as File;
      if (!route.request().headers()["range"]) return; // the whole file: never comes
      state.asked[file]++;
      if (state.dead.includes(file)) return; // no answer, ever
      if (state.lost.includes(file)) return route.abort("internetdisconnected");
      if (state.slow.includes(file)) await new Promise((resolve) => setTimeout(resolve, state.slowMs));
      await route.continue().catch(() => {});
    },
  );
  return { state, ready };
}

async function openApp(page: Page) {
  await page.goto(`/?index=${BASE}.bin`);
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/, { timeout: 60_000 });
}

/** Types the word and presses Enter once its results are in (Enter opens the first). */
async function openWord(page: Page, key: string) {
  await page.locator("#q").fill(key);
  await expect(page.locator("#scroller li.word:not(.pending)").first()).toBeVisible({ timeout: 15_000 });
  await page.locator("#q").press("Enter");
}

const STILL = /^Still (downloading|loading)$/;
const NO_SIGNAL = "Couldn’t download the definitions: no connection. They’ll show here once it’s back";
const hasBody = (f: Frame) => f.ipa + f.origin + f.classes + f.meanings + f.glosses + f.examples + f.text > 0;
const body = ({ ipa, origin, classes, meanings, glosses, examples }: Frame) => ({ ipa, origin, classes, meanings, glosses, examples });

/** Every frame shows the word as it ends (its title and other forms from the first frame),
 *  and either no part of the page, saying why, or every part: the frame it ends on. */
function expectNothingLate(frames: Frame[], last: Frame, what: string) {
  expect(frames.length, `${what}: the page was never shown`).toBeGreaterThan(0);
  for (const f of frames) expect({ word: f.word, forms: f.forms }, `${what}: the word's title changed`).toEqual({ word: last.word, forms: last.forms });
  const partial = frames.filter((f) => hasBody(f) && JSON.stringify(f) !== JSON.stringify(last));
  expect(partial, `${what}: a frame showed part of the page, or a part came late`).toEqual([]);
  const silent = frames.filter((f) => !hasBody(f) && !STILL.test(f.note) && f.note !== NO_SIGNAL);
  expect(silent, `${what}: a frame showed no part of the page and didn't say why`).toEqual([]);
}

const cases: [string, File[]][] = [...ALL.map((file): [string, File[]] => [`${FILES[file]} (the ${file} file)`, [file]]), ["every part", ALL]];

for (const [what, files] of cases) {
  test(`${what} slow to come: the whole page shows at once, nothing late`, async ({ page }) => {
    const { key, display, whole } = await word();
    await recordFrames(page);
    const net = network(page);
    await net.ready;
    net.state.slow = files;
    await openApp(page);
    await openWord(page, key);
    await expect(page.locator("#entry-word")).toHaveText(display);
    await expect.poll(async () => (await framesOf(page)).at(-1) && body((await framesOf(page)).at(-1)!), { timeout: 30_000 }).toEqual(whole);
    const frames = await framesOf(page);
    expectNothingLate(frames, frames.at(-1)!, what);
    expect(frames.at(-1)!.note).toBe("");
    // Each a wait on a slow network: per file, its first bytes, its tables and the word's
    // block, and nothing asked twice (a file opened again to check it, say).
    for (const file of ALL) expect(net.state.asked[file], `${what}: requests for the ${file} file`).toBeLessThanOrEqual(3);
  });

  test(`${what} lost on the way: the page says so, shows no part of it, then the whole of it once the signal's back`, async ({ page }) => {
    const { key, whole } = await word();
    await recordFrames(page);
    const net = network(page);
    await net.ready;
    await openApp(page);
    await page.waitForTimeout(1000); // the files opened; then they're lost
    net.state.lost = files;
    await openWord(page, key);
    await expect.poll(async () => (await framesOf(page)).at(-1)?.note, { timeout: 15_000 }).toBe(NO_SIGNAL);
    net.state.lost = [];
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => body((await framesOf(page)).at(-1)!), { timeout: 15_000 }).toEqual(whole);
    const frames = await framesOf(page);
    expectNothingLate(frames, frames.at(-1)!, what);
  });

  test(`${what} slow to come: the peek shows at once, nothing late`, async ({ page }) => {
    const { key } = await word();
    const net = network(page);
    await net.ready;
    net.state.slow = files;
    await openApp(page);
    await page.locator("#q").fill(key);
    await page.locator("#q").blur();
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { peekFrames: string[] }).peekFrames = seen;
      const look = () => {
        const peek = document.getElementById("peek");
        if (peek && !peek.hidden && peek.getBoundingClientRect().height > 0) {
          const frame = `${peek.querySelectorAll(".meanings > li").length} meanings · ${(peek.textContent ?? "").length} characters`;
          if (seen.at(-1) !== frame) seen.push(frame);
        }
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    const row = page.locator(`li.word[aria-label="${key}"] .frag`).first();
    const box = (await row.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.locator("#peek .meanings > li").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(300);
    const frames = await page.evaluate(() => (window as unknown as { peekFrames: string[] }).peekFrames);
    expect(frames, `${what}: the peek showed part of itself, or a part came late`).toHaveLength(1);
    await page.mouse.up();
  });
}

// No answer at all, never: the page may not wait for good. It says so by the reader's
// deadline (two tries of 20 s: src/definitions.ts), then fills in once the signal's back.
// About 45 s each, so on one project.
for (const [what, files] of [["its word classes and meanings", ["definitions"]], ["its examples alone", ["examples"]]] as [string, File[]][]) {
  test(`${what} getting no answer at all: the page says so, never waits for good, and fills in once the signal's back`, async ({ page }) => {
    test.skip(test.info().project.name !== "phone", "the same on every project, and slow");
    test.setTimeout(120_000);
    const { key, whole } = await word();
    await recordFrames(page);
    const net = network(page);
    await net.ready;
    await openApp(page);
    await page.waitForTimeout(1000);
    net.state.dead = files;
    await openWord(page, key);
    await expect.poll(async () => (await framesOf(page)).at(-1)?.note, { timeout: 60_000 }).toBe(NO_SIGNAL);
    net.state.dead = [];
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => body((await framesOf(page)).at(-1)!), { timeout: 15_000 }).toEqual(whole);
    const frames = await framesOf(page);
    expectNothingLate(frames, frames.at(-1)!, what);
  });
}
