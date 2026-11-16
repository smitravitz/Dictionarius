import { test, expect, type Page } from "@playwright/test";

// The published site (playwright.live.config.ts), as a person's browser meets it: nothing
// intercepted, the browser's HTTP cache on, GitHub's servers answering.
// DICTIONARIUS_LIVE_WORD: the word to look up (a common one that's in the dictionary).

const WORD = process.env.DICTIONARIUS_LIVE_WORD ?? "dictionary";
/** How long the whole dictionary (about 70 MB) may take to be kept on the device. */
const DOWNLOAD_MS = Number(process.env.DICTIONARIUS_LIVE_DOWNLOAD_MS ?? 10 * 60_000);

interface DataFile {
  sha256: string;
  bytes: number;
}

test("the servers answer a Range request for each definitions file with exactly that range", async ({ request }) => {
  const starter = (await (await request.get("headwords.starter.json")).json()) as { files: Record<string, DataFile> };
  const names = Object.keys(starter.files).filter((name) => name.endsWith(".bin"));
  expect(names).toContain("headwords.definitions.bin");
  for (const name of names) {
    const { sha256, bytes } = starter.files[name];
    const response = await request.get(`${name}?v=${sha256.slice(0, 16)}`, { headers: { Range: "bytes=64-163" } });
    const headers = response.headers();
    console.log(`${name}: ${response.status()} ${headers["content-range"] ?? "(no Content-Range)"}; ` + ["content-encoding", "etag", "cache-control", "age", "x-cache"].map((h) => `${h}: ${headers[h] ?? "-"}`).join("; "));
    expect(response.status(), `${name}: a partial answer`).toBe(206);
    expect(headers["content-range"], `${name}: the range asked for, of the size the starter lists`).toBe(`bytes 64-163/${bytes}`);
    expect((await response.body()).byteLength, `${name}: 100 bytes`).toBe(100);
  }
});

/** Everything worth knowing afterwards, with when it happened (seconds from the start). */
function watch(page: Page) {
  const started = Date.now();
  const log: string[] = [];
  const note = (what: string) => log.push(`${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s ${what}`);
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    note(`console ${message.type()}: ${message.text()}`);
    problems.push(message.text());
  });
  page.on("pageerror", (error) => {
    note(`page error: ${error.message}`);
    problems.push(error.message);
  });
  page.on("requestfailed", (request) => {
    note(`request failed: ${request.url()} ${request.headers()["range"] ?? ""} (${request.failure()?.errorText})`);
    problems.push(request.url());
  });
  page.on("response", (response) => {
    if (/\.(bin|gz)(\?|$)/.test(response.url()) && response.status() >= 400) note(`HTTP ${response.status()}: ${response.url()}`);
  });
  return { note, log, problems };
}

const bar = async (page: Page) => ((await page.locator("#download").isHidden()) ? "" : ((await page.locator("#download-text").textContent()) ?? ""));

async function readWord(page: Page, word: string, note: (what: string) => void, within: number) {
  await page.locator("#q").fill(word);
  note(`typed "${word}"; it says: ${JSON.stringify(await page.locator("#summary").textContent())}`);
  const row = page.locator(`li.word[aria-label="${word}"]`).first();
  await expect(row, "the word list arrives, and the typed word is in it").toBeVisible({ timeout: 5 * 60_000 });
  note("its results are in");
  await page.locator("#q").blur();
  await row.click();
  const tapped = Date.now();
  await expect(page.locator("#entry-word")).toHaveText(word);
  try {
    await expect(page.locator("#entry .meaning").first(), "the word's definitions show").toBeVisible({ timeout: within });
  } catch (error) {
    note(`NO DEFINITIONS after ${Date.now() - tapped} ms; the page says: ${JSON.stringify(await page.locator("#entry-note").textContent())}; the bar: ${JSON.stringify(await bar(page))}`);
    throw error;
  }
  note(`definitions shown ${Date.now() - tapped} ms after the tap; the bar: ${JSON.stringify(await bar(page))}`);
}

test("a first visit: a typed word's page fills in while the dictionary downloads, the download finishes, and the next visit needs no network", async ({ page }, testInfo) => {
  const { note, log, problems } = watch(page);
  // Past the first-run tour, which has its own tests.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("dictionarius.tour", "done");
    } catch {
      // no storage: the tour shows; the steps below don't depend on it
    }
  });
  try {
    await page.goto("./");
    await expect(page.locator("#loader")).toHaveCount(0, { timeout: 60_000 });
    note(`the app shows: ${await page.locator("#status").textContent()}`);

    // Typed straight away, while everything is still on its way.
    await readWord(page, WORD, note, 45_000);

    // The background download, to its end: every change in what the bar says, with its time.
    let last = "";
    let changed = Date.now();
    const deadline = Date.now() + DOWNLOAD_MS;
    let ended = "";
    while (Date.now() < deadline) {
      ended = (await page.locator("#offline").textContent()) ?? "";
      const now = await bar(page);
      if (now !== last) {
        // Every tenth percent, and whatever else changes (the connection's quality, the end).
        const tenth = (text: string) => text.replace(/\d+%/, (percent) => `${Math.floor(parseInt(percent) / 10)}`);
        if (tenth(now) !== tenth(last)) note(`bar: ${JSON.stringify(now)}`);
        last = now;
        changed = Date.now();
      } else if (now && Date.now() - changed > 60_000) {
        note(`the bar has said ${JSON.stringify(now)} for a minute`);
        changed = Date.now();
      }
      if (ended) break;
      await page.waitForTimeout(500);
    }
    note(`Settings says: ${JSON.stringify(ended)}`);
    expect(ended, "the whole dictionary is kept on the device").toBe("Saved on this device: works offline.");

    // The next visit: from the device, so no bar, and the word's page at once.
    await page.reload();
    await expect(page.locator("#loader")).toHaveCount(0, { timeout: 60_000 });
    note("reloaded");
    await readWord(page, WORD, note, 10_000);
    expect(await bar(page), "nothing left to download").toBe("");
    expect(problems, "no errors, warnings or failed requests along the way").toEqual([]);
  } finally {
    console.log(`\n${testInfo.project.name}: what happened\n${log.join("\n")}\n`);
    await testInfo.attach("what happened", { body: log.join("\n"), contentType: "text/plain" });
  }
});
