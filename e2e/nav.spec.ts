import { test, expect, type Page } from "@playwright/test";
import { asTheApp } from "./as-the-app";

// Back, home and forward at the top of the word list and of a word's page, for a mouse:
// back and forward step through the words followed (as a swipe does), back from the list
// goes to the start screen, home goes straight there. Plain grey glyphs like the cog's,
// no outline, no proof colour. The histogram covers them while it's open. On by default on
// every device, the app's too; a switch in Settings turns them off, and that's kept.

async function open(page: Page) {
  await page.goto("/?index=headwords-sample.bin");
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await expect(page.locator("#loader")).toHaveCount(0);
}

async function search(page: Page, text: string) {
  await page.locator("#q").fill(text);
  await page.locator("#q").blur();
  await expect(page.locator("#frame")).toBeVisible();
  await expect(page.locator("#scroller li.word:not(.pending)").first()).toBeVisible();
}

const back = (page: Page) => page.getByRole("button", { name: "Back", exact: true });
const home = (page: Page) => page.getByRole("button", { name: "Start screen" });
const forward = (page: Page) => page.getByRole("button", { name: "Forward" });
const toggle = (page: Page) => page.getByRole("switch", { name: "Navigation buttons" });

/** The first word wholly on screen in the list: its label, and a point on its letters. */
async function wordOnScreen(page: Page) {
  return page.evaluate(() => {
    const view = document.getElementById("scroller")!.getBoundingClientRect();
    for (const row of document.querySelectorAll<HTMLElement>("#scroller li.word:not(.pending)")) {
      const box = row.getBoundingClientRect();
      if (box.top < view.top + 60 || box.bottom > view.bottom) continue; // clear of the buttons
      const letters = row.querySelector(".frag")!.getBoundingClientRect();
      return { label: row.getAttribute("aria-label")!, x: letters.left + letters.width / 2, y: letters.top + letters.height / 2 };
    }
    throw new Error("no word on screen");
  });
}

const desktopOnly = () => test.skip(test.info().project.name !== "desktop", "a desktop browser's default");
const phoneOnly = () => test.skip(test.info().project.name !== "phone", "a phone's default");

test("back, home and forward sit at the top of the list and of a word's page, on every device", async ({ page }) => {
  await open(page);
  await expect(page.locator("#nav")).toBeHidden(); // nothing to go back from on the start screen
  await search(page, "ate");
  await expect(back(page)).toBeVisible();
  await expect(back(page)).toBeEnabled();
  await expect(home(page)).toBeEnabled();
  await expect(forward(page)).toBeDisabled(); // no word followed yet

  // At the top: back and home on the left, forward on the right.
  const frame = (await page.locator("#frame").boundingBox())!;
  for (const [button, side] of [[back(page), "left"], [home(page), "left"], [forward(page), "right"]] as const) {
    const box = (await button.boundingBox())!;
    expect(box.y).toBeLessThan(frame.y + 60);
    if (side === "left") expect(box.x + box.width).toBeLessThan(frame.x + frame.width / 2);
    else expect(box.x).toBeGreaterThan(frame.x + frame.width / 2);
  }

  // Not striking: the cog's grey, no outline, no proof colour.
  const cog = await page.locator("#settings-open").evaluate((el) => getComputedStyle(el).color);
  for (const button of [back(page), home(page), forward(page)]) {
    const look = await button.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, border: s.borderTopWidth, outline: s.outlineStyle };
    });
    expect(look.color).toBe(cog);
    expect(look.border).toBe("0px");
    expect(look.outline).toBe("none");
  }

  // A word: forward and back between it and the list; home to the start screen.
  const word = await wordOnScreen(page);
  await page.mouse.click(word.x, word.y);
  await expect(page.locator("#entry")).toBeVisible();
  await expect(page.locator("#entry-word")).toHaveText(word.label);
  await expect(back(page)).toBeVisible();
  const title = (await page.locator("#entry-word").boundingBox())!;
  const left = (await back(page).boundingBox())!;
  expect(left.y + left.height).toBeLessThanOrEqual(title.y); // above the word, not over it
  await back(page).click();
  await expect(page.locator("#frame")).toBeVisible();
  await expect(forward(page)).toBeEnabled();
  await forward(page).click();
  await expect(page.locator("#entry")).toBeVisible();
  await expect(page.locator("#entry-word")).toHaveText(word.label);
  await home(page).click();
  await expect(page.locator("#intro")).toBeVisible();
  await expect(page.locator("#q")).toHaveValue("");
  await expect(page.locator("#nav")).toBeHidden();

  // Back from the list: the start screen.
  await search(page, "ate");
  await back(page).click();
  await expect(page.locator("#intro")).toBeVisible();
});

test("the histogram covers them while it's open", async ({ page }) => {
  desktopOnly();
  await open(page);
  await search(page, "ate");
  const centres = await Promise.all([back(page), home(page), forward(page)].map(async (b) => {
    const box = (await b.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }));
  // Hold the space beside a word: the slider opens over the top of the list.
  const view = (await page.locator("#scroller").boundingBox())!;
  await page.mouse.move(view.x + view.width - 30, view.y + view.height / 2);
  await page.mouse.down();
  await expect(page.locator(".slider")).toHaveClass(/\bon\b/);
  await page.waitForTimeout(250); // its fade in
  // What's painted on top there (the histogram takes no clicks, so ask as if it did).
  const onTop = (at: { x: number; y: number }) =>
    page.evaluate(({ x, y }) => {
      const slider = document.querySelector<HTMLElement>(".slider")!;
      slider.style.pointerEvents = "auto";
      const top = document.elementFromPoint(x, y);
      slider.style.pointerEvents = "";
      return top?.closest(".slider") ? "slider" : top?.closest("button")?.getAttribute("aria-label") ?? null;
    }, at);
  for (const at of centres) expect(await onTop(at)).toBe("slider");
  await page.mouse.up();
  await expect(page.locator(".slider")).not.toHaveClass(/\bon\b/);
  // Closed, it's invisible and takes nothing: the button is there to press again.
  await expect.poll(() => page.locator(".slider").evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
  const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label"), centres[0]);
  expect(top).toBe("Back");
});

test("a switch in Settings turns them off, and it's kept", async ({ page }) => {
  await open(page);
  await page.locator("#settings-open").click();
  await expect(toggle(page)).toBeChecked();
  await toggle(page).click();
  await page.locator("#settings").getByRole("button", { name: "Done" }).click();
  await search(page, "ate");
  await expect(page.locator("#nav")).toBeHidden();
  await page.reload();
  await expect(page.locator("#status")).toHaveText(/^[\d,]+ words$/);
  await search(page, "ate");
  await expect(page.locator("#nav")).toBeHidden();
  await page.locator("#settings-open").click();
  await expect(toggle(page)).not.toBeChecked();
});

test("a phone starts with them too", async ({ page }) => {
  phoneOnly();
  await open(page);
  await search(page, "ate");
  await expect(back(page)).toBeVisible();
  await page.locator("#settings-open").click();
  await expect(toggle(page)).toBeChecked();
});

test("the Android app starts with them too", async ({ page }) => {
  await asTheApp(page);
  await open(page);
  await search(page, "ate");
  await expect(back(page)).toBeVisible();
  await page.locator("#settings-open").click();
  await expect(toggle(page)).toBeChecked();
});
