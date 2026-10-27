// Behaviour that applies only inside the native app shells (Capacitor).
import { Capacitor } from "@capacitor/core";

/**
 * Wire up the Android back button and outbound links.
 * `clearSearch` empties the search box and returns whether there was anything to clear.
 */
export async function setUpNativeShell(clearSearch: () => boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  // A plain navigation to another site is handed to the system browser;
  // target=_blank links would try to open a window the app doesn't have.
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[target=_blank]")) {
    link.removeAttribute("target");
  }

  // Back closes an open word, then clears the search, then leaves the app.
  const { App } = await import("@capacitor/app");
  await App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) history.back();
    else if (!clearSearch()) void App.exitApp();
  });
}
