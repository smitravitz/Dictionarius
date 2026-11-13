import { test, expect, type Page } from "@playwright/test";

// A browser's start: the word list is tens of megabytes, so the app doesn't wait for it.
// It shows as soon as its starter is in (a small file, src/starter.ts): the start screen,
// its suggestions opening landed, their words' pages and peeks. The word list comes in
// the background; a search typed before it's in says how far along it is, then shows.

/** Hold the word list back (gzipped or not) until `release()`; it's counted when asked for. */
async function holdWordList(page: Page) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let asked = 0;
  await page.route((url) => /\/headwords-sample\.bin(\.gz)?$/.test(url.pathname), async (route) => {
    asked++;
    await held;
    await route.continue();
  });
  return { release, asked: () => asked };
}

test("the app shows before the word list is in, and its suggestions open landed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); // a still start screen, to tap reliably
  const list = await holdWordList(page);
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#loader")).toHaveCount(0);
  await expect(page.locator("#status")).toHaveText("17,082 words");
  await expect(page.locator("#facts")).toHaveText(/^17,082 words · /);
  await expect.poll(list.asked).toBeGreaterThan(0); // on its way, behind the app

  await page.locator("#examples button[data-query='ing']").first().click();
  await expect(page.locator("#summary")).toHaveText(/ [\d,]+ in all$/);
  await expect(page.locator("#scroller li.word:not(.pending)").first()).toBeVisible();
  expect(await page.locator("#scroller").evaluate((el) => el.scrollTop)).toBeGreaterThan(0); // landed, not at the top
  // In view: every row filled in.
  const pendingInView = await page.locator("#scroller").evaluate((scroller) => {
    const view = scroller.getBoundingClientRect();
    return [...scroller.querySelectorAll("li.word.pending")].filter((row) => {
      const box = row.getBoundingClientRect();
      return box.bottom > view.top && box.top < view.bottom;
    }).length;
  });
  expect(pendingInView).toBe(0);

  // A word's page opens, its definitions read from the file a block at a time.
  const row = page.locator("#scroller li.word:not(.pending)").nth(2);
  const word = (await row.getAttribute("aria-label"))!;
  await row.click();
  await expect(page.locator("#entry-word")).toHaveText(word);
  await expect(page.locator("#entry .meaning, #entry-note:not([hidden])").first()).toBeVisible();
  list.release();
});

// The Android app has no starter: its worker counts a suggestion's words first, so the wait
// between the tap and the list is longer there.
for (const starter of [true, false]) {
  const how = starter ? "from the starter" : "counted, as in the Android app";
  test(`a suggestion goes straight from the start screen to its list: the box never fills in ahead of it (${how})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" }); // a still start screen, to tap reliably
    if (!starter)
      await page.route((url) => url.pathname.endsWith(".starter.json"), (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto("/?index=headwords-sample.bin");
    await expect(page.locator("#status")).toHaveText("17,082 words");
    // A mid-range phone: a CPU four times slower, so a frame in between has time to be painted.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

    // From the tap on, what every painted frame shows: the screen, and the text in the box.
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { frames: string[] }).frames = seen;
      const box = document.getElementById("q") as HTMLInputElement;
      const shown = (id: string) => !document.getElementById(id)!.hidden;
      const look = () => {
        const frame = `${shown("frame") ? "list" : shown("intro") ? "start" : "other"} "${box.value}"`;
        if (seen.at(-1) !== frame) seen.push(frame);
        if (seen.length < 50) requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    await page.locator("#examples button[data-query='ing']").first().click();
    await expect(page.locator("#scroller li.word:not(.pending)").first()).toBeVisible();
    await page.evaluate(() => new Promise(requestAnimationFrame));

    const frames = await page.evaluate(() => (window as unknown as { frames: string[] }).frames);
    expect(frames).toEqual(['start ""', 'list "ing"']);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  });
}

test("a search typed while a suggestion's list is on its way takes over: the suggestion never fills the box", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText("17,082 words");
  const tile = page.locator("#examples button[data-query='ing']").first();
  // The tap, then typing, before the worker can answer the tap: both in one task.
  await tile.evaluate((button: HTMLElement) => {
    button.click();
    const box = document.getElementById("q") as HTMLInputElement;
    box.value = "ate";
    box.dispatchEvent(new Event("input"));
  });
  await expect(page.locator("#summary")).toHaveText(/ in all$/);
  await expect(page.locator("#q")).toHaveValue("ate");
  await expect(page.locator("#scroller li.word:not(.pending)").first()).toContainText("ate");
  await expect(tile).not.toHaveAttribute("aria-busy", "true");
});

test("a search typed before the word list is in says how far along it is, then shows its words", async ({ page }) => {
  const list = await holdWordList(page);
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#loader")).toHaveCount(0);
  await page.locator("#q").fill("ate");
  await expect(page.locator("#summary")).toHaveText(/^Loading the word list…/);
  list.release();
  await expect(page.locator("#summary")).toHaveText(/ in all$/);
  await expect(page.locator("#scroller li.word:not(.pending)").first()).toBeVisible();
});

test("without a starter (an older build), the app waits for the word list, as before", async ({ page }) => {
  await page.route((url) => url.pathname.endsWith(".starter.json"), (route) => route.fulfill({ status: 404, body: "" }));
  const list = await holdWordList(page);
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#loader")).toBeVisible();
  list.release();
  await expect(page.locator("#loader")).toHaveCount(0);
  await expect(page.locator("#status")).toHaveText("17,082 words");
});

test("once it's saved on the device, the next visit downloads nothing: searches and word pages work offline", async ({ page }) => {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#loader")).toHaveCount(0);
  await page.locator("#settings-open").click();
  await expect(page.locator("#offline")).toHaveText("Saved on this device: works offline.", { timeout: 20_000 });
  await page.keyboard.press("Escape");

  // The network has none of the data now: it must all come from the device.
  await page.route((url) => /\.(bin|gz)$/.test(url.pathname) || url.pathname.endsWith(".starter.json"), (route) => route.abort());
  await page.reload();
  await expect(page.locator("#loader")).toHaveCount(0);
  await expect(page.locator("#status")).toHaveText("17,082 words");
  await page.locator("#q").fill("ingot");
  await page.locator("#q").blur();
  await page.locator('li.word[aria-label="ingot"]').click();
  await expect(page.locator("#entry-word")).toHaveText("ingot");
  await expect(page.locator("#entry .meaning")).toHaveCount(3);
});
