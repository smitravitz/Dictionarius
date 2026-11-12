// Install as an app (a browser only): where the browser offers to install Dictionarius
// (Chromium says so with a "beforeinstallprompt" event; Firefox and Safari have their own
// menus instead), Settings shows Install, which asks the browser's own prompt. The page never
// holds back the browser's own ways to install (no preventDefault), and an app (web/shell.ts)
// never offers to install itself.

/** What a browser hands the page when it offers to install it. */
interface InstallOffer extends Event {
  prompt(): Promise<unknown>;
}

export function offerInstall(row: HTMLElement, button: HTMLButtonElement, asApp: boolean): void {
  if (asApp) return;
  let offer: InstallOffer | null = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    offer = event as InstallOffer;
    row.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    offer = null;
    row.hidden = true;
  });
  button.addEventListener("click", () => {
    const asked = offer;
    if (!asked) return;
    // An offer prompts once: whatever the person answers, Install goes until the browser
    // offers again (it may, after a "not now").
    offer = null;
    row.hidden = true;
    void asked.prompt().catch(() => {});
  });
}
