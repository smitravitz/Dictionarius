// Which way Dictionarius is running, in one place: the Android app (Capacitor's shell), the
// web app installed from the browser (a PWA, in a window of its own), or a page in a browser
// tab. The first two are apps: a place of their own that the person opens and leaves, which
// Back steps out of, and which the system may close in the background and open again.
import { Capacitor } from "@capacitor/core";

export type Shell = "app" | "installed" | "browser";

/** The display modes a browser gives a web app it has installed (a window of its own);
 *  "browser" is a tab. */
const INSTALLED_DISPLAYS = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"];

/** The shell, from what the platform says: the native bridge, the display mode it shows the
 *  page in, and Safari's own flag for a page opened from the home screen. */
export function shellOf(native: boolean, displayedAs: (mode: string) => boolean, homeScreen: boolean): Shell {
  if (native) return "app";
  if (homeScreen || INSTALLED_DISPLAYS.some(displayedAs)) return "installed";
  return "browser";
}

export const SHELL: Shell = shellOf(
  Capacitor.isNativePlatform(),
  (mode) => matchMedia(`(display-mode: ${mode})`).matches,
  (navigator as { standalone?: boolean }).standalone === true,
);

/** An app (the Android app, or the web app installed): not a page in a tab. */
export const AS_APP = SHELL !== "browser";
