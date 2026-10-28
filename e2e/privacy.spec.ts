import { test, expect, type Page } from "@playwright/test";

// The app talks to no server (privacy.toml): the page's Content-Security-Policy
// lets it load and request only its own files, and nothing in it tries more.

/** Record every Content-Security-Policy violation from the first moment on. */
async function recordViolations(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = seen;
    document.addEventListener("securitypolicyviolation", (e) => seen.push(`${e.effectiveDirective} ${e.blockedURI}`));
  });
}
const violations = (page: Page) => page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations);

async function open(page: Page, index = "headwords-sample.bin") {
  await page.goto(`/?index=${encodeURIComponent(index)}`);
}

test("the page refuses to contact other servers", async ({ page }) => {
  await recordViolations(page);
  await open(page);
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await page.evaluate(async () => {
    await fetch("https://example.com/collect").catch(() => {});
    const img = new Image();
    img.src = "https://example.com/pixel.png";
    await new Promise((done) => setTimeout(done, 200));
  });
  await expect.poll(() => violations(page)).toEqual([
    "connect-src https://example.com/collect",
    "img-src https://example.com/pixel.png",
  ]);
});

test("searching, opening a word and the settings break none of the page's rules", async ({ page, baseURL }) => {
  await recordViolations(page);
  const elsewhere: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== new URL(baseURL!).origin && !/^(data|blob):/.test(r.url())) elsewhere.push(r.url());
  });
  await open(page);
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await page.locator("#q").fill("ate");
  await expect(page.locator("#summary")).toHaveText(/in all$/);
  await page.locator("#q").blur();
  await page.locator("li.word").first().click();
  await expect(page.locator("#entry")).toBeVisible();
  await page.goBack();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.keyboard.press("Escape");
  expect(await violations(page)).toEqual([]);
  expect(elsewhere).toEqual([]);
});

test("a link can't point the app at a word list on another server", async ({ page }) => {
  const elsewhere: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).hostname === "example.com") elsewhere.push(r.url());
  });
  await open(page, "https://example.com/headwords.bin");
  // It falls back to the app's own word list (missing from the test server).
  await expect(page.locator("#status")).toHaveText("Word list unavailable");
  await expect(page.locator("#summary")).not.toHaveText(/connection/);
  expect(elsewhere).toEqual([]);
});
