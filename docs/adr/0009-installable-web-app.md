# ADR-0009: The web app installs as an app, and an installed app behaves like the Android one

- **Status:** Accepted; built 2026-11-12 (v0.7.2); amended 2026-11-12: opens from the device at once, comes back straight to a word, dark by default, keeps its storage once installed
- **Date:** 2026-11-12
- **Deciders:** project owner
- **Builds on:** [ADR-0008](0008-web-start-in-layers.md) (the page and its data kept on the device)
- **Related:** `web/shell.ts`, `web/main.ts` (history, place), `web/install.ts`, `web/sw.js`,
  `web/theme.ts`, `web/theme-boot.js`, `web/dots.ts`, `tools/web-app.ts`,
  `tools/theme-script.ts`, `tools/make-icons.ts`, `web/icons/`, `e2e/back.spec.ts`,
  `e2e/place.spec.ts`, `e2e/install.spec.ts`, `e2e/theme.spec.ts`, `e2e/built/install.spec.ts`,
  `e2e/built/opening.spec.ts`, `test/web-app.test.ts`

## Context and problem statement

After ADR-0008 the web app on Pages worked offline after one visit, but a browser couldn't
install it (no manifest, no icons), and opened from a home screen it would still have acted
like a page in a tab: Back from the results closed it, it forgot where the person was when the
phone closed it in the background, and on a weak signal it waited for the network before
showing anything. The Android app does all of these better already.

## Decision drivers

- One app: what the person can do and how Back behaves shouldn't depend on where it came from
  (the APK or the browser), only on whether it's an app or a page in a tab.
- One place that says which: no scattered checks for "the app".
- Private and offline: nothing new reaches a server (`privacy.toml` unchanged), no prompts the
  person didn't ask for.
- Nothing appears and then changes: the theme picked shows from the first frame.

## Considered options

1. **An app is an app** (chosen): the installed web app takes the Android app's ways (history
   steps, place kept), decided in one module (`web/shell.ts`).
2. **Installable only** (a manifest and icons): installs, but Back closes it from the results
   and the phone closing it loses the search.
3. **CloseWatcher for Back** (Chromium's close requests, not history): works only where
   Chromium has it, is limited against "back-trapping" without a user gesture, and would be a
   second way to answer the Android app's Back.

## Decision

- **Which shell** (`web/shell.ts`): the Android app (Capacitor's bridge), the web app
  **installed** (display mode `standalone`, `fullscreen`, `minimal-ui` or
  `window-controls-overlay`, or Safari's `navigator.standalone`), or a page in a **browser**
  tab. `AS_APP` is true for the first two.
- **History follows the screen** (`main.ts`'s `settleHistory`). In an app the results are a
  step on from the start screen and a word's page a step on from the results, so Back goes
  word → results → start screen → out. In a tab only the words followed are a step (as before).
  Going somewhere by hand (clearing the box, a new search on a word's page, home) takes the
  steps it left out of the history (`history.go`), so Back never does nothing; Forward after
  Back to the start screen brings the search back. The Android app's Back now only closes a
  panel, then steps back through this history while it can; its own "clear the search" step is
  gone (the history step does it). Each start's history step is the start screen's.
- **Place** (`web/place.ts`) is kept and restored in any app, not only the Android one. A
  place with a word open comes back straight to that word's page: the screen stays as the app
  started (a browser's loading screen, the app's start screen) until the page is ready, then
  the search is set up behind it in the same frame, for Back to find the list as far down as
  it was. (At first it showed the list, then opened the word: two screens, the first a flash.)
- **Installable** (`tools/web-app.ts`, web build and dev server only): the page links
  `app.webmanifest` (name, description and colours read from the page's own `<title>` and
  `<meta>` tags, so they can't disagree; `display: standalone`; start and scope `./`), a
  favicon and an iOS home-screen icon. Icons are drawn once from `docs/brand/icon.svg` by
  `tools/make-icons.ts` and committed in `web/icons/`: rounded "any" icons (192, 512),
  a square "maskable" one (512) whose glyph sits inside the 80% safe circle, and an opaque
  180 px `apple-touch-icon`. The splash and bars use the light paper colour.
- **Install** in Settings, only where the browser offers it (`beforeinstallprompt`, Chromium),
  asking the browser's own prompt; never in an app; the browser's own ways to install are left
  alone (no `preventDefault`).
- **The service worker** moves from `tools/web-data.ts` to `tools/web-app.ts` and keeps the
  manifest, icons and theme script with the page. Its build name now hashes each file's
  contents, not only names: the manifest and icons keep their names from build to build.
  Once kept, the page opens from the device **at once**, whatever the network is doing; with
  nothing kept, it waits as any page does. A new build comes down in the background and takes
  over once no page of the old one is open (no `skipWaiting`), so it opens from the next start
  and an open page never asks for a file of its build that's gone. (At first the page waited
  up to 2 s for the network's copy, so a new build showed at once: on a phone that wait, on
  every open, was most of the white screen before the loading screen.)
- **Light or dark** (`web/theme.ts`, a switch at the top right of Settings): **dark** on every
  device, whatever the system's own setting, unless the person picks light; only light is kept
  (`dictionarius.theme`), so picking dark again goes back to the default. It sets
  `:root[data-theme]` (the hook styles.css already had), the theme-color tags and, in the
  Android app, the status bar icons' colour (Capacitor's SystemBars, set to light icons from
  launch). A plain script, `web/theme-boot.js`, in every build's `<head>`
  (`tools/theme-script.ts`), puts the theme on the page before its first frame. The manifest's
  splash and the Android app's launch screen are the dark paper too. (At first it followed the
  system, with a pick against it kept; the owner asked for dark everywhere.)
- **Still downloading** (`web/dots.ts`): a word's page whose definitions haven't come after
  300 ms says "Still downloading" (the Android app, which downloads nothing: "Still loading"),
  with dots coming and going (". .. ... .."). The loading screen's dots are the same: one CSS
  animation of opacity only, so the words never shift; its own timer is gone.

## Consequences

- From Pages, Chromium browsers offer to install the app; it opens in its own window, from the
  device, and behaves as the Android app does (Back, place, theme).
- In a browser tab Back is as before, except that a step left behind by going somewhere by
  hand is taken out (Back from a word's page after a new search leaves the page at once
  instead of doing nothing once).
- Installed, the app asks for persistent storage (`navigator.storage.persist()`) at each
  start, so its settings, place and kept dictionary aren't cleared when the device runs short
  of space: Chromium grants it to an installed app without asking, Firefox may ask once. A tab
  doesn't ask (the person never chose to keep it); the Android app's storage is its own. (At
  first nothing asked, to spare Firefox's prompt; the owner asked for settings kept for good.)
- The manifest has one `background_color`: the splash is light paper even when the page is
  dark (browsers offer no dark splash yet).
- iOS has no install prompt to ask; Safari's Share → Add to Home Screen works with the
  manifest and touch icon. No page text says so.

## Evidence

- `test/web-app.test.ts`: the web build links the manifest, favicon and touch icon; the
  manifest's fields and colours (checked against styles.css's `--paper`); each icon's PNG size
  against the manifest; the service worker keeps them and no data file; the build name follows
  contents; the theme script is a plain script in the head, after the theme-color tags, in both
  builds; the icons come from the current brand icon. The Android app's build has none of it.
- `e2e/built/install.spec.ts`: Chrome's own installability check
  (`Page.getInstallabilityErrors`) finds nothing; the maskable icon's glyph stays inside the
  safe circle on an opaque square; the touch icon is opaque; the PNGs match the SVG.
- `e2e/built/opening.spec.ts`: once kept, the page's first frame comes within a second with
  the network 30 s slow; a copy of the site given a new build serves the kept build at once,
  holds the new one waiting while a page is open, and opens it from the next start; a first
  visit waits for the network. Measured with the real dictionary on a 4× slowed phone, from
  asking to open to the loading screen: 1,632 ms with the network answering in 1.5 s and
  2,125 ms with it answering in 5 s, before; 150 to 295 ms after, whatever the network.
- `e2e/place.spec.ts` also records every frame of a restore with a word open: the word's page
  is the first screen after the start, never the list.
- `e2e/back.spec.ts`, `e2e/place.spec.ts`: Back and place, as the installed app (Chromium can't
  emulate the display mode, so `asInstalled` answers that one media query) and as the Android
  app; Back in a tab.
- `e2e/install.spec.ts`, `e2e/theme.spec.ts` (including every frame of a reload, with the page's
  scripts held back), `e2e/entry.spec.ts` (Still downloading: every dot step seen, the line's
  width unchanged; still with reduced motion).

## Open questions

- Confirm on a phone: Android's Back closes Settings (Chromium closes a modal dialog on Back)
  before stepping through the history, in the installed app.
- Chromium's Back skips history steps a page added without a tap or key (its guard against
  back-trapping). Restoring a place adds the results' and word's steps as the app starts:
  confirm on a phone that Back after a restore still goes word → results → start screen.
