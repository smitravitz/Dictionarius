// The light/dark switch at the top right of Settings (web/theme-choice.ts says which theme).
// Turning it turns the page (:root[data-theme], styles.css), the browser's bars (the page's
// theme-color) and, in the Android app, the colour of the status bar's icons, all at once.
// web/theme-boot.js does the same for a kept pick before the page's first frame.
import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import { SHELL } from "./shell";
import { THEME_KEY, themePicked, themeToKeep, type Theme } from "./theme-choice";

/** The device's storage, as main.ts reaches it (it may be missing or blocked). */
export interface Kept {
  read(key: string): string | null;
  write(key: string, value: string): void;
  forget(key: string): void;
}

export function setUpTheme(toggle: HTMLButtonElement, kept: Kept): void {
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const system = (): Theme => (dark.matches ? "dark" : "light");
  // The page's own bar colours, one for each system setting (index.html), before any pick
  // changed them (web/theme-boot.js notes them as it does).
  const bars = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  for (const meta of bars) meta.dataset.own ??= meta.content;
  const barsFor = (theme: Theme) => bars.find((meta) => meta.media.includes(theme))?.dataset.own ?? "";

  /** Show `picked`, or the system's theme when nothing is picked. */
  function show(picked: Theme | null) {
    const root = document.documentElement;
    if (picked) root.dataset.theme = picked;
    else delete root.dataset.theme;
    for (const meta of bars) meta.content = picked ? barsFor(picked) : meta.dataset.own!;
    toggle.setAttribute("aria-checked", String((picked ?? system()) === "dark"));
    if (SHELL === "app") {
      // Light icons on dark, dark on light; or the phone's own choice, following its setting.
      const style = picked === "dark" ? SystemBarsStyle.Dark : picked === "light" ? SystemBarsStyle.Light : SystemBarsStyle.Default;
      void SystemBars.setStyle({ style }).catch(() => {});
    }
  }

  toggle.addEventListener("click", () => {
    const now = themePicked(kept.read(THEME_KEY)) ?? system();
    const keep = themeToKeep(now === "dark" ? "light" : "dark", system());
    if (keep) kept.write(THEME_KEY, keep);
    else kept.forget(THEME_KEY);
    show(keep);
  });
  // The system turned light or dark: followed, unless a pick holds.
  dark.addEventListener("change", () => show(themePicked(kept.read(THEME_KEY))));
  show(themePicked(kept.read(THEME_KEY)));
}
