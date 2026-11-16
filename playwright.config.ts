import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run the real app (Vite dev server, Web Worker, virtual list)
// against the small public-domain fixture index, on a desktop and a phone.

// The same tests in Safari's engine (WebKit), at an iPhone's size: the engine the iOS app
// runs in, which the projects below (all Chromium) never touch. Asked for by name
// (`npm run test:e2e:safari`), so a plain `playwright test` runs what it always has.
// Left out: the files whose gestures or slow-phone timing go through Chromium's own devtools
// (a swipe, a touch that holds and slides, a throttled CPU), which WebKit doesn't have; and
// kept-copy.spec.ts, which plants a wrong file in the device's store from the page and looks
// for the right one afterwards: in Playwright's WebKit the page sees that store empty after a
// reload while the app's workers still read from it (CI, 2026-11-16: Settings said saved, the
// page listed no files), so the test can't look. No test of the kept dictionary runs in
// Safari's engine yet (start.spec.ts and built/ are out too): an open item.
const SAFARI = !!process.env.DICTIONARIUS_SAFARI;
const safari = {
  name: "iphone-safari",
  testIgnore: ["**/back.spec.ts", "**/dropdown.spec.ts", "**/positions.spec.ts", "**/start.spec.ts", "**/kept-copy.spec.ts", "**/built/**", "**/live/**"],
  use: { ...devices["iPhone 15"] },
};

export default defineConfig({
  testDir: "e2e",
  // The published build's own tests (playwright.built.config.ts), and the live site's
  // (playwright.live.config.ts).
  testIgnore: ["**/built/**", "**/live/**"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    // Every test starts past the first-run tour, except e2e/tour.spec.ts, which is about it.
    storageState: "e2e/tour-done.json",
    trace: "retain-on-failure",
  },
  projects: SAFARI ? [safari] : [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
    // Everything again, on a first run: the tour on, acting its steps out on the same screens.
    // It must change nothing any other test relies on (e2e/tour.spec.ts tests the tour itself).
    {
      name: "first-run",
      testIgnore: ["**/tour.spec.ts", "**/word-page-sample.spec.ts", "**/word-page-network.spec.ts", "**/built/**", "**/live/**"],
      use: { ...devices["Pixel 7"], storageState: { cookies: [], origins: [] } },
    },
  ],
  webServer: {
    command: "npx vite --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    // The fixture, or the folder of a real word list for e2e/word-page-sample.spec.ts.
    env: { DICTIONARIUS_PUBLIC: resolve(process.env.DICTIONARIUS_SAMPLE_DATA ?? "test/fixtures") },
  },
});
