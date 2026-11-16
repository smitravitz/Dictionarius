import { defineConfig, devices } from "@playwright/test";

// The web app where it's really published (GitHub Pages), in real browsers, with nothing in
// between: no dev server, no request interception (so the browser's own HTTP cache is on, as
// it is for a person), GitHub's servers answering. What only the live site can show: how its
// servers answer Range requests, and a first visit over the real network.
// Run: npm run test:e2e:live (Chrome), or with --project edge (needs Microsoft Edge installed).
// Another address: DICTIONARIUS_LIVE_URL=https://example.org/app/ (end it with a slash).
export default defineConfig({
  testDir: "e2e/live",
  outputDir: "test-results-live",
  fullyParallel: false,
  workers: 1, // one download of the dictionary at a time
  retries: 0, // a failure here is news: don't hide it behind a second go
  timeout: 15 * 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-live" }]] : "list",
  use: {
    baseURL: process.env.DICTIONARIUS_LIVE_URL ?? "https://smitravitz.github.io/Dictionarius/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "edge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
  ],
});
