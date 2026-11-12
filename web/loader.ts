// The loading screen a browser shows until the app can work: its starter (src/starter.ts),
// a small file, or the word list where there's no starter. The word list and definitions
// come behind it (ADR-0008). The Android app reads its files from the phone itself in a
// moment, so it never shows this screen.
import { Capacitor } from "@capacitor/core";

export interface Loader {
  /** Whether the page waits for everything (a browser) or not (the app). */
  readonly waits: boolean;
  /** Everything is in: show the app. */
  done(): void;
  /** Something didn't load: say so, and how to try again. */
  failed(): void;
}

export function setUpLoader(screen: HTMLElement, app: HTMLElement): Loader {
  const waits = !Capacitor.isNativePlatform();
  if (!waits) {
    screen.remove();
    return { waits, done() {}, failed() {} };
  }
  app.inert = true; // under the loading screen: nothing in it can be reached
  return {
    waits,
    done() {
      app.inert = false;
      screen.classList.add("gone"); // fades out, then leaves
      const leave = () => screen.remove();
      screen.addEventListener("transitionend", leave, { once: true });
      setTimeout(leave, 600); // in case no transition runs (reduced motion)
    },
    failed() {
      screen.classList.add("stuck");
      screen.querySelector(".loader-text")!.textContent = "Dictionarius couldn’t load. Reload the page to try again.";
    },
  };
}
