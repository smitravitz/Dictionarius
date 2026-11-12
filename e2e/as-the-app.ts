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

/**
 * Run the page as the web app runs once installed from the browser (a PWA, in a window of
 * its own): the browser then answers `(display-mode: standalone)`, which Chromium can't be
 * made to emulate (its DevTools protocol ignores display-mode), so this answers it instead,
 * and only it: every other media query is the browser's own.
 */
export async function asInstalled(page: Page) {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      const list = real(query);
      const mode = /\(\s*display-mode\s*:\s*([a-z-]+)\s*\)/.exec(query)?.[1];
      if (mode) Object.defineProperty(list, "matches", { value: mode === "standalone" });
      return list;
    };
  });
}

/** The definitions and their layers: the files the app reads in place. */
export const DEFINITIONS_FILES = /\.(definitions|examples|etymology|pronunciation)\.bin$/;
