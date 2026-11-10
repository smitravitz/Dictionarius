import { test, expect } from "@playwright/test";

// The published web app, after one visit, opens and works with no network at all: the
// page itself from the service worker (web/sw.js), the word list and the definitions
// from the device (web/data-cache.ts).

test("after one visit, the app opens and works offline", async ({ page, context }) => {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#loader")).toHaveCount(0);
  await page.locator("#settings-open").click();
  await expect(page.locator("#offline")).toHaveText("Saved on this device: works offline.", { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#loader")).toHaveCount(0);
  await expect(page.locator("#status")).toHaveText("17,082 words");
  await page.locator("#q").fill("ingot");
  await page.locator("#q").blur();
  await page.locator('li.word[aria-label="ingot"]').click();
  await expect(page.locator("#entry-word")).toHaveText("ingot");
  await expect(page.locator("#entry .meaning")).toHaveCount(3);
});

test("the start screen's suggestions open at once, before the word list is in", async ({ page }) => {
  // As published: the starter beside the word list, the word list gzipped behind it.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route((url) => /\/headwords-sample\.bin(\.gz)?$/.test(url.pathname), async (route) => {
    await held;
    await route.continue();
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#loader")).toHaveCount(0);
  await page.locator("#examples button[data-query='ing']").first().click();
  await expect(page.locator("#summary")).toHaveText(/ [\d,]+ in all$/);
  release();
});
