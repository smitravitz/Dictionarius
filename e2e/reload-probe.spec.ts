import { test, expect, type Page } from "@playwright/test";

// TEMPORARY experiment, not a test of the app (branch safari-reload-flake-check, to be
// deleted): the flow of download-bar.spec.ts's "with the dictionary already on the device,
// the bar never shows", repeated, printing per run whether the app let go of a kept copy
// during the first visit, what the page's store held before and after the reload, and
// whether the bar showed after it.

async function network(page: Page) {
  await page.context().route(
    (url) => /\.(bin|gz)$/.test(url.pathname),
    async (route) => {
      if (route.request().headers()["range"]) return route.continue().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue().catch(() => {});
    },
  );
}

const store = (page: Page) =>
  page.evaluate(async () => {
    const s = await caches.open("dictionarius-data");
    return (await s.keys()).map((r) => new URL(r.url).pathname.split("/").pop()).sort().join(",");
  });

test("probe: first visit, reload, what survived", async ({ page }, info) => {
  const said: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "warning" || m.type() === "error") said.push(m.text().slice(0, 160));
  });
  const wholeAfterReload: string[] = [];
  let reloaded = false;
  page.on("request", (r) => {
    if (reloaded && /\.(bin|gz)(\?|$)/.test(r.url()) && !r.headers()["range"]) wholeAfterReload.push(new URL(r.url()).pathname.split("/").pop()!);
  });
  await network(page);
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/, { timeout: 30_000 });
  await expect(page.locator("#download-text")).toHaveText("Downloaded · works offline", { timeout: 30_000 });
  const before = await store(page);
  reloaded = true;
  await page.reload();
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  const after = await store(page);
  let barShown = false;
  for (let i = 0; i < 15; i++) {
    if (!(await page.locator("#download").isHidden())) barShown = true;
    await page.waitForTimeout(100);
  }
  const letGo = said.filter((s) => s.includes("let go of")).length;
  console.log(`PROBE ${info.project.name} #${info.repeatEachIndex} barShown=${barShown} letGo=${letGo} refetched=[${wholeAfterReload.join(",")}] before=[${before}] after=[${after}] warnings=${JSON.stringify(said)}`);
});
