// The loading screen a browser shows until the word list and every definition are in,
// so once the app appears it is all there: no "loading" anywhere inside it. The Android
// app reads its files from the phone itself in a moment, so it never shows this screen
// and keeps its own order (the start screen first, the definitions a little later).
import { Capacitor } from "@capacitor/core";

/** The dots after "Loading Dictionarius", one to three and back. */
export const DOTS = [".", "..", "...", ".."];
const DOT_MS = 420;

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
  const dots = screen.querySelector<HTMLElement>(".loader-dots")!;
  let step = 0;
  const timer = setInterval(() => (dots.textContent = DOTS[++step % DOTS.length]), DOT_MS);
  return {
    waits,
    done() {
      clearInterval(timer);
      app.inert = false;
      screen.classList.add("gone"); // fades out, then leaves
      const leave = () => screen.remove();
      screen.addEventListener("transitionend", leave, { once: true });
      setTimeout(leave, 600); // in case no transition runs (reduced motion)
    },
    failed() {
      clearInterval(timer);
      screen.classList.add("stuck");
      screen.querySelector(".loader-text")!.textContent = "Dictionarius couldn’t load. Reload the page to try again.";
    },
  };
}
