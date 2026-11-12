import { test, expect, type Page } from "@playwright/test";

// Opening on a weak signal: once the page is kept on the device (web/sw.js), opening it waits
// for the network's copy only briefly (a new build shows at once when the network answers),
// then opens the kept page rather than leaving the person in front of nothing. With nothing
// kept yet (a first visit), it waits for the network as any page does.

const START = "/?index=headwords-sample.bin";
const PATIENCE_MS = 2_000; // web/sw.js

async function visitOnce(page: Page) {
  await page.goto(START);
  await expect(page.locator("#status")).toHaveText("17,082 words");
  // Kept, and in charge of the page's next visit.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}

/** From now on the network answers for the page itself (its HTML) only after `ms`. */
async function slowPage(page: Page, ms: number) {
  await page.context().route(
    (url) => url.pathname === "/" && url.search === new URL(START, "http://x").search,
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await route.continue().catch(() => {}); // the page may be long gone by then
    },
  );
}

test("on a weak signal, it opens from the kept page once the network has had its moment", async ({ page }) => {
  await visitOnce(page);
  await slowPage(page, 30_000);
  const asked = Date.now();
  await page.reload({ waitUntil: "commit" });
  await expect(page.locator("#status")).toHaveText("17,082 words", { timeout: 10_000 });
  const waited = Date.now() - asked;
  expect(waited).toBeGreaterThanOrEqual(PATIENCE_MS - 200); // the network had its chance first
  expect(waited).toBeLessThan(PATIENCE_MS + 4_000); // and not much more
});

test("a network that answers in time is what opens (so a new build shows at once)", async ({ page }) => {
  await visitOnce(page);
  // The network's copy of the page, marked so it can be told from the kept one.
  await page.context().route(
    (url) => url.pathname === "/" && url.search === new URL(START, "http://x").search,
    async (route) => {
      const response = await route.fetch();
      const html = (await response.text()).replace("<title>Dictionarius</title>", "<title>Dictionarius (from the network)</title>");
      await route.fulfill({ response, body: html });
    },
  );
  await page.reload();
  await expect(page).toHaveTitle("Dictionarius (from the network)");
});

test("with nothing kept yet, a slow network is waited for, as any page's", async ({ page }) => {
  await slowPage(page, 3_000);
  const asked = Date.now();
  await page.goto(START);
  await expect(page.locator("#status")).toHaveText("17,082 words", { timeout: 15_000 });
  expect(Date.now() - asked).toBeGreaterThanOrEqual(3_000 - 200);
});
