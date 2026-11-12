// Light or dark: dark on every device, whatever the system's own setting, unless the person
// picks light in Settings. Only a pick away from the default is kept (on the device, under
// THEME_KEY); picking dark again forgets it. No DOM here: web/theme.ts draws it,
// web/theme-boot.js puts it on the page before its first frame.

export type Theme = "light" | "dark";

/** The theme with nothing picked. web/theme-boot.js, the manifest's colours
 *  (tools/web-app.ts) and the Android app's splash and status bar start from the same. */
export const DEFAULT_THEME: Theme = "dark";

/** Where the pick is kept on the device. web/theme-boot.js reads the same key. */
export const THEME_KEY = "dictionarius.theme";

/** The theme picked, from what's kept: null if nothing (or nothing sensible) is. */
export function themePicked(kept: string | null): Theme | null {
  return kept === "light" || kept === "dark" ? kept : null;
}

/** The theme the page shows: the pick, else the default. */
export function themeShown(kept: string | null): Theme {
  return themePicked(kept) ?? DEFAULT_THEME;
}

/** What to keep for a pick: itself when it's not the default, else nothing. */
export function themeToKeep(picked: Theme): Theme | null {
  return picked === DEFAULT_THEME ? null : picked;
}
