import { test, expect, type Page } from "@playwright/test";

// A diagnostic, not a test of the app (to be removed): what the page can see of the device's
// store (Cache Storage) across a reload, in each engine. It prints what it finds.

const view = (page: Page) =>
  page.evaluate(async () => {
    const names = await caches.keys();
    const store = await caches.open("dictionarius-data");
    const files = await Promise.all((await store.keys()).map(async (r) => `${new URL(r.url).pathname.split("/").pop()}=${(await (await store.match(r))!.blob()).size}`));
    const probe = await (await caches.open("probe")).keys();
    return { caches: names, files, probe: probe.map((r) => new URL(r.url).pathname), settings: document.getElementById("offline")?.textContent };
  });

test("diagnostic: the page's view of the device's store, before and after a reload", async ({ page }, info) => {
  const whole: string[] = [];
  page.on("request", (r) => {
    if (/\.(bin|gz)(\?|$)/.test(r.url()) && !r.headers()["range"]) whole.push(new URL(r.url()).pathname.split("/").pop()!);
  });
  const say = (what: string, value: unknown) => console.log(`STORE-VIEW [${info.project.name}] ${what}: ${JSON.stringify(value)}`);
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#offline")).toHaveText("Saved on this device: works offline.", { timeout: 20_000 });
  say("1 after the first visit", await view(page));
  say("1 whole-file requests", whole.splice(0));
  // The page's own writes: one in the app's store, one in a store of its own.
  await page.evaluate(async () => {
    await (await caches.open("dictionarius-data")).put("/sentinel-in-data", new Response("x"));
    await (await caches.open("probe")).put("/sentinel-in-probe", new Response("x"));
  });
  say("2 after the page's own writes", await view(page));
  await page.reload();
  await expect(page.locator("#status")).toHaveText("17,082 words");
  say("3 just after a reload", await view(page));
  await page.waitForTimeout(6000);
  say("4 six seconds on", await view(page));
  say("4 whole-file requests since the reload", whole.splice(0));
  await page.reload();
  await expect(page.locator("#status")).toHaveText("17,082 words");
  await page.waitForTimeout(3000);
  say("5 after a second reload", await view(page));
  say("5 whole-file requests since", whole.splice(0));
});
