import { test, expect, type Page } from "@playwright/test";
import { asInstalled, asTheApp } from "./as-the-app";

// Install as an app: where the browser offers to install Dictionarius (Chromium says so with a
// "beforeinstallprompt" event), Settings has an Install button that asks the browser's own
// install prompt. Nowhere else: not where the browser doesn't offer it, not once installed,
// not in an app already. The browser's own ways to install (its menu, its banner) stay as
// they are: the page doesn't hold them back.
// A test browser never decides by itself that a page can be installed, so the browser's offer
// is made here as the browser makes it: an event on the window carrying prompt().

async function open(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await expect(page.locator("#loader")).toHaveCount(0);
}

/** The browser offers to install the page; `answer` is what the person then picks in its prompt. */
async function browserOffers(page: Page, answer: "accepted" | "dismissed" = "accepted") {
  return page.evaluate((answer) => {
    const offer = new Event("beforeinstallprompt", { cancelable: true }) as Event & Record<string, unknown>;
    const w = window as unknown as { prompted: number; heldBack: boolean };
    w.prompted = 0;
    offer.prompt = async () => {
      w.prompted++;
      return { outcome: answer };
    };
    offer.userChoice = Promise.resolve({ outcome: answer, platform: "web" });
    window.dispatchEvent(offer);
    w.heldBack = offer.defaultPrevented;
  }, answer);
}

const prompted = (page: Page) => page.evaluate(() => (window as unknown as { prompted: number }).prompted);
const settings = (page: Page) => page.locator("#settings");
const install = (page: Page) => settings(page).getByRole("button", { name: "Install" });

test("where the browser offers it, Settings has Install, which asks the browser's own prompt", async ({ page }) => {
  await open(page);
  await browserOffers(page);
  expect(await page.evaluate(() => (window as unknown as { heldBack: boolean }).heldBack)).toBe(false);
  await page.locator("#settings-open").click();
  await expect(settings(page).getByText("Install as an app")).toBeVisible();
  await expect(install(page)).toBeVisible();
  await install(page).click();
  expect(await prompted(page)).toBe(1);
  // Installed: the browser says so, and there's nothing left to offer.
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(install(page)).toBeHidden();
});

test("an offer can be used once: turned down, Install goes until the browser offers again", async ({ page }) => {
  await open(page);
  await browserOffers(page, "dismissed");
  await page.locator("#settings-open").click();
  await install(page).click();
  await expect(install(page)).toBeHidden();
  expect(await prompted(page)).toBe(1);
  await browserOffers(page);
  await expect(install(page)).toBeVisible();
});

test("where the browser doesn't offer it, Settings has no Install", async ({ page }) => {
  await open(page);
  await page.locator("#settings-open").click();
  await expect(settings(page).getByRole("switch").first()).toBeVisible();
  await expect(settings(page).getByText("Install as an app")).toBeHidden();
  await expect(install(page)).toBeHidden();
});

for (const app of [
  { name: "installed from the browser", as: asInstalled },
  { name: "the Android app", as: asTheApp },
]) {
  test(`an app (${app.name}) never offers to install itself`, async ({ page }) => {
    await app.as(page);
    await open(page);
    await browserOffers(page);
    await page.locator("#settings-open").click();
    await expect(settings(page).getByRole("switch").first()).toBeVisible();
    await expect(install(page)).toBeHidden();
  });
}
