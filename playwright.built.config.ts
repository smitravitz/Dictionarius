import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Tests of the web app as published (pages.yml's build: DICTIONARIUS_WEB=1), served as
// GitHub Pages serves it: what only a production build has, such as working offline
// (web/sw.js). Run: npm run test:e2e:built. The main suite (playwright.config.ts) runs
// the dev server instead.
export default defineConfig({
  testDir: "e2e/built",
  outputDir: "test-results-built", // its own: a run of it mustn't clear the main suite's results
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-built" }]] : "list",
  use: {
    baseURL: "http://localhost:4174",
    storageState: "e2e/tour-done.json",
    trace: "retain-on-failure",
  },
  projects: [{ name: "built", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "npx vite build --outDir ../build/e2e-web --emptyOutDir && npx vite preview --outDir ../build/e2e-web --port 4174 --strictPort",
    url: "http://localhost:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { DICTIONARIUS_PUBLIC: resolve("test/fixtures"), DICTIONARIUS_WEB: "1" },
  },
});
