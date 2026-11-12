import { test, expect, type Page } from "@playwright/test";
import { asTheApp } from "./as-the-app";

// Light or dark: a switch at the top right of Settings, above the other switches. Dark on
// every device from the very first frame, whatever the system's own setting, until the
// person picks light; that pick is kept on the device, and the page opens in it from its
// very first frame too. The browser's bars (theme-color) follow the page.

const LIGHT_PAPER = "rgb(243, 245, 248)"; // styles.css --paper, light: #f3f5f8
const DARK_PAPER = "rgb(14, 20, 32)"; // and dark: #0e1420

async function open(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await expect(page.locator("#loader")).toHaveCount(0);
}

const darkMode = (page: Page) => page.locator("#settings").getByRole("switch", { name: "Dark mode" });
const paper = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const barColours = (page: Page) =>
  page.locator('meta[name="theme-color"]').evaluateAll((metas) => metas.map((m) => m.getAttribute("content")));

async function settings(page: Page) {
  await page.locator("#settings-open").click();
  await expect(page.locator("#settings")).toBeVisible();
}

/** The theme on the page at every frame from the first, as it opens, with its own scripts
 *  slow to come (as on a slow phone): frames are drawn before they run. Read with frames(). */
async function watchFrames(page: Page) {
  await page.route(/\/main\.ts$|\/assets\/index-[\w-]+\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.addInitScript(() => {
    const seen: (string | undefined)[] = [];
    (window as unknown as { frames_: typeof seen }).frames_ = seen;
    const note = () => {
      seen.push(document.documentElement.dataset.theme);
      if (seen.length < 30) requestAnimationFrame(note);
    };
    requestAnimationFrame(note);
  });
}
const frames = (page: Page) => page.evaluate(() => (window as unknown as { frames_: (string | undefined)[] }).frames_);

test("Settings has a light/dark switch at its top right, above the other switches", async ({ page }) => {
  await open(page);
  await settings(page);
  const sheet = (await page.locator("#settings").boundingBox())!;
  const toggle = (await darkMode(page).boundingBox())!;
  const title = (await page.locator("#settings-title").boundingBox())!;
  const firstSwitch = (await page.locator("#settings .setting").first().boundingBox())!;
  expect(toggle.x + toggle.width).toBeGreaterThan(sheet.x + sheet.width - 40); // at the right
  expect(toggle.x).toBeGreaterThan(sheet.x + sheet.width / 2);
  expect(Math.abs(toggle.y + toggle.height / 2 - (title.y + title.height / 2))).toBeLessThan(6); // level with the title
  expect(toggle.y + toggle.height).toBeLessThanOrEqual(firstSwitch.y + 1); // above the switches
  expect(toggle.width).toBeGreaterThanOrEqual(44); // a thumb's worth
  expect(toggle.height).toBeGreaterThanOrEqual(44);
});

for (const system of ["light", "dark"] as const) {
  test(`dark from the very first frame, on a ${system} system too`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: system });
    await watchFrames(page);
    await open(page);
    const seen = await frames(page);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((theme) => theme !== "dark")).toStrictEqual([]); // toEqual would let undefined through
    expect(await paper(page)).toBe(DARK_PAPER);
    expect(await barColours(page)).toEqual(["#0e1420", "#0e1420"]); // whichever the system asks for
    await settings(page);
    await expect(darkMode(page)).toHaveAttribute("aria-checked", "true");
  });
}

test("the Android app starts dark too", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await asTheApp(page);
  await open(page);
  expect(await paper(page)).toBe(DARK_PAPER);
});

test("turning it to light turns the page and the browser's bars at once, and back to dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);
  await settings(page);
  await darkMode(page).click();
  await expect(darkMode(page)).toHaveAttribute("aria-checked", "false");
  expect(await paper(page)).toBe(LIGHT_PAPER);
  expect(await barColours(page)).toEqual(["#f3f5f8", "#f3f5f8"]);

  await darkMode(page).click();
  await expect(darkMode(page)).toHaveAttribute("aria-checked", "true");
  expect(await paper(page)).toBe(DARK_PAPER);
  expect(await barColours(page)).toEqual(["#0e1420", "#0e1420"]);
  // Dark is the default: nothing to keep.
  expect(await page.evaluate(() => localStorage.getItem("dictionarius.theme"))).toBeNull();
});

test("light, once picked, is kept: the page opens light from its very first frame", async ({ page }) => {
  await open(page);
  await settings(page);
  await darkMode(page).click();
  await watchFrames(page);
  await page.reload();
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  const seen = await frames(page);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter((theme) => theme !== "light")).toStrictEqual([]);
  expect(await paper(page)).toBe(LIGHT_PAPER);
  expect(await barColours(page)).toEqual(["#f3f5f8", "#f3f5f8"]);
  await settings(page);
  await expect(darkMode(page)).toHaveAttribute("aria-checked", "false");
});

test("the system turning light or dark changes nothing", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);
  await page.emulateMedia({ colorScheme: "light" });
  expect(await paper(page)).toBe(DARK_PAPER);
  await settings(page);
  await darkMode(page).click(); // light, picked
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await paper(page)).toBe(LIGHT_PAPER);
  await expect(darkMode(page)).toHaveAttribute("aria-checked", "false");
});

test("the switch changes by opacity and turning only, and not at all with reduced motion", async ({ page }) => {
  await open(page);
  await settings(page);
  const moving = await darkMode(page).evaluate((button) =>
    [...button.querySelectorAll("svg > g")].map((glyph) => getComputedStyle(glyph).transitionProperty),
  );
  expect(moving.length).toBe(2); // a sun and a moon
  for (const properties of moving) expect(properties.split(/,\s*/).sort()).toEqual(["opacity", "transform"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const still = await darkMode(page).evaluate((button) =>
    [...button.querySelectorAll("svg > g")].map((glyph) => getComputedStyle(glyph).transitionDuration),
  );
  expect(still).toEqual(["0s", "0s"]);
});
