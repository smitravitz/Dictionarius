import { test, expect, type Page } from "@playwright/test";

// The page draws edge to edge, under the phone's status and navigation bars,
// and keeps its own content clear of them. In the Android app, Capacitor's
// SystemBars plugin tells the page how tall the bars are as CSS variables
// (--safe-area-inset-*); newer WebViews also report them through env().

const GESTURE_BAR = 24; // a phone's gesture navigation bar, in CSS px

async function openUnderBars(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  // What the SystemBars plugin sets once the app is running (and again when the bars change).
  await page.evaluate((bottom) => {
    document.documentElement.style.setProperty("--safe-area-inset-bottom", `${bottom}px`);
  }, GESTURE_BAR);
}

test("the credit's links sit clear of the gesture bar, each big enough for a thumb", async ({ page }) => {
  await openUnderBars(page);
  const height = page.viewportSize()!.height;
  const links = page.locator(".credit a");
  expect(await links.count()).toBe(3);
  for (const link of await links.all()) {
    const name = (await link.textContent()) ?? "";
    const box = (await link.boundingBox())!;
    expect(box.height, name).toBeGreaterThanOrEqual(44);
    expect(box.y + box.height, name).toBeLessThanOrEqual(height - GESTURE_BAR);
  }
});
