import { test, expect, type Page, type Route } from "@playwright/test";
import { asTheApp, DEFINITIONS_FILES } from "./as-the-app";

// The app reads its definitions in place: each block by a Range request (ADR-0005).
// Whatever the server does with those requests, a word's page shows all of it.

async function openApp(page: Page) {
  await asTheApp(page);
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
}

/** ingot's whole page: pronunciation, both word classes, origin and its example. */
async function expectIngot(page: Page) {
  await page.locator("#q").fill("ingot");
  await page.locator('li.word[aria-label="ingot"]').click();
  const entry = page.locator("#entry");
  await expect(page.locator("#entry-word")).toHaveText("ingot");
  await expect(entry.locator(".word-class-name")).toHaveText(["noun", "verb"]);
  await expect(entry.locator(".entry-ipa")).toHaveText("/ˈɪŋ.ɡət/");
  await expect(entry.locator(".entry-origin")).toHaveText("From a made-up Middle English word.");
  await expect(entry.locator(".example")).toHaveText(["He weighed the made-up ingot."]);
  await expect(entry.locator(".entry-note")).toBeHidden();
}

/** The whole file, as Capacitor's own server answers a Range request: 206, but every byte. */
async function wholeAs206(route: Route) {
  const response = await route.fetch({ headers: { ...route.request().headers(), range: "" } });
  const body = await response.body();
  const range = route.request().headers()["range"] ?? "bytes=0-0";
  const [, a, b] = /bytes=(\d+)-(\d*)/.exec(range) ?? ["", "0", "0"];
  await route.fulfill({ status: 206, body, headers: { "content-range": `bytes ${a}-${b}/${body.length}` } });
}

test("in the app, a word's page is read in place: ranges only, never a whole definitions file", async ({ page }) => {
  const asked: { url: string; range: string | null }[] = [];
  page.context().on("request", async (request) => {
    if (DEFINITIONS_FILES.test(request.url())) asked.push({ url: request.url(), range: (await request.allHeaders())["range"] ?? null });
  });
  await openApp(page);
  await expectIngot(page);
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.filter((a) => a.range === null), "a whole definitions file was fetched").toEqual([]);
});

test("in the app, a server that says 206 but sends the whole file (Capacitor's) still shows the whole page", async ({ page }) => {
  await page.context().route(DEFINITIONS_FILES, (route) => (route.request().headers()["range"] ? wholeAs206(route) : route.continue()));
  await openApp(page);
  await expectIngot(page);
});

test("in the app, ranges that stop working after the files opened still show the whole page", async ({ page }) => {
  const seen = new Map<string, number>();
  await page.context().route(DEFINITIONS_FILES, (route) => {
    const n = (seen.get(route.request().url()) ?? 0) + 1;
    seen.set(route.request().url(), n);
    return n <= 2 || !route.request().headers()["range"] ? route.continue() : wholeAs206(route);
  });
  await openApp(page);
  await expectIngot(page);
});

test("in the app, a block request that fails still shows the whole page", async ({ page }) => {
  const seen = new Map<string, number>();
  await page.context().route(DEFINITIONS_FILES, (route) => {
    const n = (seen.get(route.request().url()) ?? 0) + 1;
    seen.set(route.request().url(), n);
    return n === 3 ? route.abort("failed") : route.continue();
  });
  await openApp(page);
  await expectIngot(page);
});
