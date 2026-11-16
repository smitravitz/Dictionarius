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

const keptSize = (page: Page, name: string) =>
  page.evaluate(async (name) => {
    const store = await caches.open("dictionarius-data");
    const request = (await store.keys()).find((r) => new URL(r.url).pathname.endsWith(name));
    return request ? (await (await store.match(request))!.blob()).size : null;
  }, name);

async function readIngot(page: Page) {
  await page.locator("#q").fill("ingot");
  await page.locator("#q").blur();
  await page.locator('li.word[aria-label="ingot"]').click();
  await expect(page.locator("#entry-word")).toHaveText("ingot");
  await expect(page.locator("#entry .meaning")).toHaveCount(3);
  await expect(page.locator("#entry-note")).not.toHaveText(/No definition/);
}

for (const how of ["cut short", "zeros"] as const) {
  test(`a kept copy of the definitions that's ${how === "zeros" ? "not the file at all" : how} is let go of: the word's page still fills in`, async ({ page }) => {
    await visitUntilSaved(page);
    const size = await spoil(page, "headwords-sample.definitions.bin", how);
    await page.reload();
    await expect(page.locator("#loader")).toHaveCount(0);
    await readIngot(page);
    // And the right file is kept again, for the next visit.
    await expect.poll(() => keptSize(page, "headwords-sample.definitions.bin"), { timeout: 20_000 }).toBe(size);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const store = await caches.open("dictionarius-data");
          const request = (await store.keys()).find((r) => new URL(r.url).pathname.endsWith("headwords-sample.definitions.bin"))!;
          return new TextDecoder().decode((await (await store.match(request))!.arrayBuffer()).slice(0, 8));
        }),
      )
      .toBe("DICTDEF1");
  });
}

for (const how of ["cut short", "zeros"] as const) {
  test(`a kept copy of one layer that's ${how === "zeros" ? "not the file at all" : how} is let go of too, and kept again`, async ({ page }) => {
    await visitUntilSaved(page);
    const size = await spoil(page, "headwords-sample.etymology.bin", how);
    await page.reload();
    await expect(page.locator("#loader")).toHaveCount(0);
    await readIngot(page);
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const store = await caches.open("dictionarius-data");
            const request = (await store.keys()).find((r) => new URL(r.url).pathname.endsWith("headwords-sample.etymology.bin"));
            return request ? new TextDecoder().decode((await (await store.match(request))!.arrayBuffer()).slice(0, 8)) : null;
          }),
        { timeout: 20_000 },
      )
      .toBe("DICTDEF1");
    expect(await keptSize(page, "headwords-sample.etymology.bin")).toBe(size);
  });
}
