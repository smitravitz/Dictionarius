import { test, expect, type Page } from "@playwright/test";
import { asInstalled, asTheApp } from "./as-the-app";

// Settings never has an Install button: not in a tab, not where the browser offers to install
// Dictionarius (Chromium says so with a "beforeinstallprompt" event), not in an app. Installing
// is the browser's own to offer (its menu, its address bar), and the page doesn't hold that
// back (ADR-0009).
// A test browser never decides by itself that a page can be installed, so the browser's offer
// is made here as the browser makes it: an event on the window carrying prompt().

async function open(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await expect(page.locator("#loader")).toHaveCount(0);
}

/** The browser offers to install the page. */
async function browserOffers(page: Page) {
  return page.evaluate(() => {
    const offer = new Event("beforeinstallprompt", { cancelable: true }) as Event & Record<string, unknown>;
    const w = window as unknown as { prompted: number; heldBack: boolean };
    w.prompted = 0;
    offer.prompt = async () => {
      w.prompted++;
      return { outcome: "accepted" };
    };
    offer.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
    window.dispatchEvent(offer);
    w.heldBack = offer.defaultPrevented;
  });
}

for (const shell of [
  { name: "a browser tab", as: async (_: Page) => {} },
  { name: "installed from the browser", as: asInstalled },
  { name: "the Android app", as: asTheApp },
]) {
  test(`Settings has no Install, even when the browser offers one (${shell.name})`, async ({ page }) => {
    await shell.as(page);
    await open(page);
    await browserOffers(page);
    // The browser's own ways to install stay as they are, and the page never prompts.
    expect(await page.evaluate(() => (window as unknown as { heldBack: boolean }).heldBack)).toBe(false);
    await page.locator("#settings-open").click();
    const settings = page.locator("#settings");
    await expect(settings.getByRole("switch").first()).toBeVisible();
    await expect(settings.getByRole("button", { name: /install/i })).toHaveCount(0);
    await expect(settings).not.toContainText(/install/i);
    expect(await page.evaluate(() => (window as unknown as { prompted: number }).prompted)).toBe(0);
  });
}
