import { test, expect, type Page } from "@playwright/test";

// The dictionary kept on the device (web/data-cache.ts) is read before the network. A kept
// copy that's wrong (cut short, or not the file it should be) must cost a download, never a
// word's definitions: before, the page trusted it, the definitions failed to open, and every
// word said it had none, on every visit, until the site's data was cleared by hand.

async function visitUntilSaved(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#loader")).toHaveCount(0);
  await expect(page.locator("#offline")).toHaveText("Saved on this device: works offline.", { timeout: 20_000 });
}

/** Swap the kept copy of the file named `name` for `make(its bytes)`; returns the right size. */
function spoil(page: Page, name: string, how: "cut short" | "zeros") {
  return page.evaluate(
    async ([name, how]) => {
      const store = await caches.open("dictionarius-data");
      const request = (await store.keys()).find((r) => new URL(r.url).pathname.endsWith(name))!;
      const bytes = new Uint8Array(await (await store.match(request))!.arrayBuffer());
      await store.put(request, new Response(how === "cut short" ? bytes.slice(0, bytes.length >> 1) : new Uint8Array(bytes.length)));
      return bytes.length;
    },
    [name, how] as const,
  );
}

/** What the page's console said (the app warns when it lets go of a copy, or can't keep one). */
function consoleOf(page: Page): string[] {
  const said: string[] = [];
  page.on("console", (message) => said.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => said.push(`error: ${error.message}`));
  return said;
}

/** Waits until the file named `name` is kept again and starts as a definitions file does;
 *  returns its size. If it never is, the error says what the page was saying meanwhile. */
async function keptAgain(page: Page, name: string, said: string[]): Promise<number | null> {
  const look = () =>
    page.evaluate(async (name) => {
      const store = await caches.open("dictionarius-data");
      const request = (await store.keys()).find((r) => new URL(r.url).pathname.endsWith(name));
      if (!request) return null;
      const bytes = await (await store.match(request))!.arrayBuffer();
      return { size: bytes.byteLength, starts: new TextDecoder().decode(bytes.slice(0, 8)) };
    }, name);
  const until = Date.now() + 12_000;
  let seen: Awaited<ReturnType<typeof look>> = null;
  while (Date.now() < until) {
    seen = await look();
    if (seen?.starts === "DICTDEF1") return seen.size;
    await page.waitForTimeout(250);
  }
  const state = await page.evaluate(async () => ({
    settings: document.getElementById("offline")?.textContent,
    bar: document.getElementById("download")?.hidden ? "(hidden)" : document.getElementById("download-text")?.textContent,
    kept: (await (await caches.open("dictionarius-data")).keys()).map((r) => new URL(r.url).pathname.split("/").pop()),
    storage: await navigator.storage?.estimate?.().catch(() => null),
  }));
  throw new Error(`${name} wasn't kept again (last seen: ${JSON.stringify(seen)}). The page: ${JSON.stringify(state)}. Its console: ${JSON.stringify(said)}`);
}

async function readIngot(page: Page) {
  await page.locator("#q").fill("ingot");
  await page.locator("#q").blur();
  await page.locator('li.word[aria-label="ingot"]').click();
  await expect(page.locator("#entry-word")).toHaveText("ingot");
  await expect(page.locator("#entry .meaning")).toHaveCount(3);
  await expect(page.locator("#entry-note")).not.toHaveText(/No definition/);
}

for (const how of ["cut short", "zeros"] as const) {
  for (const file of ["headwords-sample.definitions.bin", "headwords-sample.etymology.bin"]) {
    const what = file.includes("definitions") ? "the definitions" : "one layer";
    test(`a kept copy of ${what} that's ${how === "zeros" ? "not the file at all" : how} is let go of: the word's page still fills in, and the file is kept again`, async ({ page }) => {
      const said = consoleOf(page);
      await visitUntilSaved(page);
      const size = await spoil(page, file, how);
      await page.reload();
      await expect(page.locator("#loader")).toHaveCount(0);
      await readIngot(page);
      // And the right file is kept again in this visit, for the next one.
      expect(await keptAgain(page, file, said)).toBe(size);
    });
  }
}
