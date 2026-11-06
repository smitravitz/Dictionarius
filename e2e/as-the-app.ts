import type { Page } from "@playwright/test";

/**
 * Run the page as the Android app runs it, in a browser: Capacitor's documented hook for
 * custom platforms makes `isNativePlatform()` true, so the app takes its own paths (no
 * loading screen; definitions read in place, a block at a time). Its native plugins have
 * no implementation here; the app already shrugs off a plugin call that fails.
 */
export async function asTheApp(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { CapacitorCustomPlatform: { name: string } }).CapacitorCustomPlatform = { name: "app-in-a-test" };
  });
}

/** The definitions and their layers: the files the app reads in place. */
export const DEFINITIONS_FILES = /\.(definitions|examples|etymology|pronunciation)\.bin$/;
