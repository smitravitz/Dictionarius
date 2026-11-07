import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run the real app (Vite dev server, Web Worker, virtual list)
// against the small public-domain fixture index, on a desktop and a phone.
export default defineConfig({
  testDir: "e2e",
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
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
    // Everything again, on a first run: the tour on, acting its steps out on the same screens.
    // It must change nothing any other test relies on (e2e/tour.spec.ts tests the tour itself).
    {
      name: "first-run",
      testIgnore: ["**/tour.spec.ts", "**/word-page-sample.spec.ts"],
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
