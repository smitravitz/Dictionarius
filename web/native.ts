// Behaviour that applies only inside the native app shells (Capacitor).
import { Capacitor } from "@capacitor/core";

/** What the Android back button does before it steps back through the history. */
export interface BackSteps {
  /** Close an open panel (settings), returning whether one was open. */
  closePanel(): boolean;
}

/** Wire up the Android back button and outbound links. */
export async function setUpNativeShell(back: BackSteps): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  // A plain navigation to another site is handed to the system browser;
  // target=_blank links would try to open a window the app doesn't have.
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[target=_blank]")) {
    link.removeAttribute("target");
  }

  // Back closes a panel, then steps back through the history: from any word followed
  // straight to the results (one step for them all; swipes step one word at a time), then
  // to the start screen (main.ts keeps those steps); from there it leaves the app.
  const { App } = await import("@capacitor/app");
  await App.addListener("backButton", ({ canGoBack }) => {
    if (back.closePanel()) return;
    if (canGoBack) history.back();
    else void App.exitApp();
  });
}
