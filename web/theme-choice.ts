// Light or dark: the system's setting, unless the person picked the other one in Settings.
// Only a pick against the system is kept (on the device, under THEME_KEY); picking the
// system's own again forgets it, so the page follows the system again (a phone that turns
// dark at night, say). No DOM here: web/theme.ts draws it, web/theme-boot.js puts it on the page
// before its first frame.

export type Theme = "light" | "dark";

/** Where the pick is kept on the device. web/theme-boot.js reads the same key. */
export const THEME_KEY = "dictionarius.theme";

/** The theme picked, from what's kept: null if nothing (or nothing sensible) is. */
export function themePicked(kept: string | null): Theme | null {
  return kept === "light" || kept === "dark" ? kept : null;
}

/** The theme the page shows: the pick, else the system's. */
export function themeShown(kept: string | null, system: Theme): Theme {
  return themePicked(kept) ?? system;
}

/** What to keep for a pick: itself when it's against the system, else nothing. */
export function themeToKeep(picked: Theme, system: Theme): Theme | null {
  return picked === system ? null : picked;
}
