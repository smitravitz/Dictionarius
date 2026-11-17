import { test, expect, type Page } from "@playwright/test";

// The page draws edge to edge, under the phone's status and navigation bars,
// and keeps its own content clear of them. In the Android app, Capacitor's
// SystemBars plugin tells the page how tall the bars are as CSS variables
// (--safe-area-inset-*); newer WebViews also report them through env().

const GESTURE_BAR = 24; // a phone's gesture navigation bar, in CSS px

async function openUnderBars(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await expect(page.locator("#loader")).toHaveCount(0); // a browser shows the app once all is in
  // What the SystemBars plugin sets once the app is running (and again when the bars change).
  await page.evaluate((bottom) => {
    document.documentElement.style.setProperty("--safe-area-inset-bottom", `${bottom}px`);
  }, GESTURE_BAR);
}

test("the credit's links sit clear of the gesture bar, each big enough for a thumb", async ({ page }) => {
  await openUnderBars(page);
  const height = page.viewportSize()!.height;
  const links = page.locator(".credit a");
  expect(await links.count()).toBe(3);
  for (const link of await links.all()) {
    const name = (await link.textContent()) ?? "";
    const box = (await link.boundingBox())!;
    expect(box.height, name).toBeGreaterThanOrEqual(44);
    expect(box.y + box.height, name).toBeLessThanOrEqual(height - GESTURE_BAR);
  }
});

test("the start screen opens in order: everything in place first, the word count fading in after, nothing moving", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { loadAt?: number; builtAt?: number; framesAfter?: number };
    // When the suggestions are built, and how many frames are drawn after that before the load.
    new MutationObserver(() => {
      if (w.builtAt !== undefined || !document.querySelector("#examples .tile")) return;
      w.builtAt = performance.now();
      w.framesAfter = 0;
      const count = () => {
        if (w.loadAt !== undefined) return;
        w.framesAfter!++;
        requestAnimationFrame(count);
      };
      requestAnimationFrame(count);
    }).observe(document, { childList: true, subtree: true });
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: never[]) {
      if ((message as { type?: string })?.type === "load" && w.loadAt === undefined) w.loadAt = performance.now();
      return send.call(this, message, ...rest);
    } as typeof Worker.prototype.postMessage;
  });
  // The word list arrives late, as on a slow phone.
  await page.route((url) => url.pathname.endsWith("/headwords-sample.bin"), async (route) => {
    await new Promise((r) => setTimeout(r, 1000));
    await route.continue();
  });
  await page.goto("/?index=headwords-sample.bin");
  const facts = page.locator("#facts");
  const lens = page.locator(".search .lens");
  await expect(page.locator("#examples .tile").first()).toBeAttached();
  await expect(facts).not.toBeVisible(); // its place is kept, but nothing shows until the count is known
  const factsBefore = (await facts.boundingBox())!;
  const lensBefore = (await lens.boundingBox())!;

  await expect(facts).toHaveText(/^[\d,]+ words · every definition · fully offline$/);
  await expect(facts).toBeVisible();
  const factsAfter = (await facts.boundingBox())!;
  const lensAfter = (await lens.boundingBox())!;
  expect(factsAfter.y).toBe(factsBefore.y);
  expect(factsAfter.height).toBe(factsBefore.height);
  expect(lensAfter.x).toBe(lensBefore.x); // the funnel's place was kept too

  // The word list was only asked for once the start screen was built and drawn.
  const { loadAt, builtAt, framesAfter } = await page.evaluate(() => {
    const w = window as unknown as { loadAt: number; builtAt: number; framesAfter: number };
    return { loadAt: w.loadAt, builtAt: w.builtAt, framesAfter: w.framesAfter };
  });
  expect(loadAt).toBeGreaterThan(builtAt);
  expect(framesAfter).toBeGreaterThanOrEqual(1);
});

test("the worked example sits under the search field, above the fragments, and goes with the start screen", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 }); // tall enough to show it (styles.css drops it on a short screen)
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await expect(page.locator("#loader")).toHaveCount(0);
  const example = page.locator(".specimen");
  await expect(example).toHaveText("“eren” finds serene, coherent, adherence, etc.");
  await expect(example).toBeVisible();
  const [field, line, fragments] = [(await page.locator(".search").boundingBox())!, (await example.boundingBox())!, (await page.locator("#examples").boundingBox())!];
  expect(line.y).toBeGreaterThanOrEqual(field.y + field.height);
  expect(line.y + line.height).toBeLessThanOrEqual(fragments.y);
  // Its words start at the page's left margin, like the rest (just past its opening quote mark).
  const [margin, firstWord] = [(await page.locator(".tagline").boundingBox())!.x, (await example.locator("mark").first().boundingBox())!.x];
  expect(firstWord - margin).toBeGreaterThan(0);
  expect(firstWord - margin).toBeLessThan(16);

  // A search: the list takes the start screen's place, the example with it.
  await page.locator("#q").fill("ate");
  await expect(page.locator("#frame")).toBeVisible();
  await expect(example).toBeHidden();
});
