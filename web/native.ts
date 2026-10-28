// Behaviour that applies only inside the native app shells (Capacitor).
import { Capacitor } from "@capacitor/core";

/** Steps the Android back button takes, each returning whether it did anything. */
export interface BackSteps {
  /** Close an open panel (settings). */
  closePanel(): boolean;
  /** Empty the search box. */
  clearSearch(): boolean;
}

/** Wire up the Android back button and outbound links. */
export async function setUpNativeShell(back: BackSteps): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  // A plain navigation to another site is handed to the system browser;
  // target=_blank links would try to open a window the app doesn't have.
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[target=_blank]")) {
    link.removeAttribute("target");
  }

  // Back closes a panel, then an open word, then clears the search, then
  // leaves the app.
  const { App } = await import("@capacitor/app");
  await App.addListener("backButton", ({ canGoBack }) => {
    if (back.closePanel()) return;
    if (canGoBack) history.back();
    else if (!back.clearSearch()) void App.exitApp();
  });
}
