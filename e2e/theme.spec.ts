import { test, expect, type Page } from "@playwright/test";

// Light or dark: a switch at the top right of Settings, above the other switches. The page
// follows the system's setting until the person picks the other one; that pick is kept on the
// device and the page opens in it from its very first frame; picking the system's own again
// goes back to following the system. The browser's bars (theme-color) follow the page.

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

test("it starts as the system is, and turning it turns the page and the browser's bars at once", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  await settings(page);
  await expect(darkMode(page)).toHaveAttribute("aria-checked", "false");
  expect(await paper(page)).toBe(LIGHT_PAPER);

  await darkMode(page).click();
  await expect(darkMode(page)).toHaveAttribute("aria-checked", "true");
  expect(await paper(page)).toBe(DARK_PAPER);
  expect(await barColours(page)).toEqual(["#0e1420", "#0e1420"]); // whichever the system asks for

  await darkMode(page).click();
  await expect(darkMode(page)).toHaveAttribute("aria-checked", "false");
  expect(await paper(page)).toBe(LIGHT_PAPER);
  expect(await barColours(page)).toEqual(["#f3f5f8", "#0e1420"]); // each for its own system setting again
});

test("on a dark system it starts dark, and the switch can make it light", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);
  await settings(page);
  await expect(darkMode(page)).toHaveAttribute("aria-checked", "true");
  expect(await paper(page)).toBe(DARK_PAPER);
  await darkMode(page).click();
  expect(await paper(page)).toBe(LIGHT_PAPER);
  expect(await barColours(page)).toEqual(["#f3f5f8", "#f3f5f8"]);
});

test("the pick is kept: the page opens in it from its very first frame", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  await settings(page);
  await darkMode(page).click();

  // Every frame from the first, as the page opens again, its own scripts slow to come (as on a
  // slow phone): frames are drawn before they run, and those must be dark already.
  await page.route(/\/main\.ts$|\/assets\/index-[\w-]+\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.addInitScript(() => {
    const frames: (string | undefined)[] = [];
    (window as unknown as { frames_: typeof frames }).frames_ = frames;
    const note = () => {
      frames.push(document.documentElement.dataset.theme);
      if (frames.length < 30) requestAnimationFrame(note);
    };
    requestAnimationFrame(note);
  });
  await page.reload();
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  const frames = await page.evaluate(() => (window as unknown as { frames_: (string | undefined)[] }).frames_);
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.filter((theme) => theme !== "dark")).toStrictEqual([]); // toEqual would let undefined (no theme) through
  expect(await paper(page)).toBe(DARK_PAPER);
  expect(await barColours(page)).toEqual(["#0e1420", "#0e1420"]);
  await settings(page);
  await expect(darkMode(page)).toHaveAttribute("aria-checked", "true");
});

test("picking the system's own again follows the system from then on", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  await settings(page);
  await darkMode(page).click(); // dark, against the system: kept
  await darkMode(page).click(); // light, the system's own: nothing to keep
  expect(await page.evaluate(() => localStorage.getItem("dictionarius.theme"))).toBeNull();
  await page.emulateMedia({ colorScheme: "dark" }); // the system turns dark (at night, say)
  await expect.poll(() => paper(page)).toBe(DARK_PAPER);
  await expect(darkMode(page)).toHaveAttribute("aria-checked", "true");
});

test("a pick against the system holds when the system changes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  await settings(page);
  await expect(darkMode(page)).toHaveAttribute("aria-checked", "false");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(darkMode(page)).toHaveAttribute("aria-checked", "true"); // following the system
  await darkMode(page).click(); // light, against the dark system: kept
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await paper(page)).toBe(LIGHT_PAPER);
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
