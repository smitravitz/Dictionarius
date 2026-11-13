import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

// Takes the screenshots the stores ask for (tools/store-screenshots/screens.spec.ts), one
// project per store, each at a size that store takes:
// - the App Store wants the 6.9-inch iPhone: 1320 by 2868 px;
// - Google Play wants a phone no taller than twice its width: 1080 by 2160 px.
const phone = (width: number, height: number) => ({
  viewport: { width, height },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

export default defineConfig({
  testDir: "tools/store-screenshots",
  outputDir: "test-results-store",
  reporter: "list",
  use: { baseURL: "http://localhost:4175", storageState: { cookies: [], origins: [{ origin: "http://localhost:4175", localStorage: [{ name: "dictionarius.tour", value: "done" }] }] } },
  projects: [
    { name: "app-store-iphone", use: phone(440, 956) },
    { name: "google-play-phone", use: phone(360, 720) },
  ],
  webServer: {
    command: "npx vite --port 4175 --strictPort",
    url: "http://localhost:4175",
    reuseExistingServer: !process.env.CI,
    env: { DICTIONARIUS_PUBLIC: resolve(process.env.DICTIONARIUS_SAMPLE_DATA ?? "test/fixtures") },
  },
});
