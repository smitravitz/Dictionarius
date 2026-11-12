// The light/dark switch at the top right of Settings (web/theme-choice.ts says which theme).
// Turning it turns the page (:root[data-theme], styles.css), the browser's bars (the page's
// theme-color) and, in the Android app, the colour of the status bar's icons, all at once.
// web/theme-boot.js does the same before the page's first frame.
import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import { SHELL } from "./shell";
import { THEME_KEY, themeShown, themeToKeep, type Theme } from "./theme-choice";

/** The device's storage, as main.ts reaches it (it may be missing or blocked). */
export interface Kept {
  read(key: string): string | null;
  write(key: string, value: string): void;
  forget(key: string): void;
}

export function setUpTheme(toggle: HTMLButtonElement, kept: Kept): void {
  // The page's bar colours, one per theme (index.html, by the system setting each is for),
  // before anything changed them (web/theme-boot.js notes them as it does).
  const bars = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  for (const meta of bars) meta.dataset.own ??= meta.content;
  const barsFor = (theme: Theme) => bars.find((meta) => meta.media.includes(theme))?.dataset.own ?? "";

  function show(theme: Theme) {
    document.documentElement.dataset.theme = theme;
    for (const meta of bars) meta.content = barsFor(theme); // whatever the system asks for
    toggle.setAttribute("aria-checked", String(theme === "dark"));
    // In the Android app, light icons on dark, dark on light.
    if (SHELL === "app") void SystemBars.setStyle({ style: theme === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
  }

  toggle.addEventListener("click", () => {
    const picked: Theme = themeShown(kept.read(THEME_KEY)) === "dark" ? "light" : "dark";
    const keep = themeToKeep(picked);
    if (keep) kept.write(THEME_KEY, keep);
    else kept.forget(THEME_KEY);
    show(picked);
  });
  show(themeShown(kept.read(THEME_KEY)));
}
