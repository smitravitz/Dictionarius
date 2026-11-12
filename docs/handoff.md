# Handoff: where the project stands

Read this first in a new chat, then `.claude/CLAUDE.md`. Update it at the end of any
session that changes what's below (newest state only; history lives in git).

_Last updated: 2026-11-12, at v0.7.1 (v0.7.0 and v0.7.1 shipped the web start in layers, ADR-0008, and place restore); on main, unreleased: the installable web app with light/dark and "Still downloading" (ADR-0009)._

## What it is

Dictionarius: an offline, open-source English dictionary that finds a word from any part
of it. TypeScript web app (no framework, Vite 7) wrapped for Android with Capacitor 8.
Search is an FM-index in a Web Worker; definitions are a brotli-blocked file. Data is
built from the English Wiktionary dump by `scripts/build_fm_index.py`.

- Data formats: `docs/index-format.md`, `docs/definitions-format.md`
- Decisions: `docs/adr/` (ADR-0005, layered data packs: Proposed, its step 1 built;
  ADR-0006, letter and position conditions as bitmaps: Proposed; ADR-0009, the installable
  web app: Accepted)
- Build, test, release: `docs/development.md`

## Where things are

| Path | What |
|---|---|
| `src/` | Search engine, definitions reader, filters (runs in the worker; unit-tested) |
| `web/` | The page: `main.ts`, the worker `search-worker.ts`, the data worker `data-worker.ts`, gestures, loading screen `loader.ts`, service worker `sw.js`, which shell it runs in `shell.ts`, light/dark `theme.ts` (+ `theme-boot.js`), the web app's icons `icons/` |
| `tools/` | Vite steps: `web-data.ts` (starter, gzipped list), `web-app.ts` (manifest, icons, service worker), `theme-script.ts`; `make-icons.ts` draws `web/icons/` from `docs/brand/icon.svg` |
| `scripts/` | Python data pipeline, `setup-release.sh`, privacy audit |
| `e2e/` | Playwright tests (desktop + phone) against `test/fixtures` sample data |
| `android/` | Capacitor Android shell, `EdgeGesturesPlugin.java` |
| `.github/workflows/` | `ci.yml`, `release.yml` (tag → signed APK), `pages.yml` (web app on Pages) |

## Shipping

- Release: `git tag -a vX.Y.Z -m "notes" && git push origin vX.Y.Z` (the owner pushes tags;
  sessions can't). Builds the signed APK, publishes the GitHub release, then starts
  `pages.yml` on main to put that version at https://smitravitz.github.io/Dictionarius/.
- Republish Pages without a release: Actions → Pages → Run workflow.
- Before a release publishes, it checks the data opens with the tagged code and that 40
  randomly picked real words show their whole page, in a browser and in the app's mode
  (`e2e/word-page-sample.spec.ts`). The Java that reads definitions in place runs on an
  Android emulator whenever it changes (`android-device.yml`).
- Data changes: rebuild with the pipeline, then `bash scripts/setup-release.sh …` uploads
  the files as a `data-<sum>` release and updates `data/headwords.sha256`; commit that.

## Rules that always apply

- No chat traces in anything published (see `.claude/CLAUDE.md`; the list is
  `.github/chat-traces.txt`). Commit footer: only `Co-Authored-By: …`. The "No chat traces"
  workflow takes session links out of pull requests, issues, comments, reviews and release
  notes, and fails on a commit, tag, file or earlier edited version that carries one.
  Sessions push branches and give the owner the link to open the pull request: a session's
  GitHub access adds its session's link to a pull request it opens.
- Offline and private: no network permission, no trackers; `privacy.toml` is the budget.
- Commit bug fixes as commits; don't bump versions or tag unless asked.
- Measure before claiming size or speed (ADR-0005's gates).

## State

- Latest release **v0.7.1** (2026-11-11), on the format-3 data pinned in
  `data/headwords.sha256` (a core file plus examples, etymology and pronunciation layers).
- Navigation buttons (back, home, forward) over the list and word pages, on by default in a
  desktop browser, a switch in Settings; the funnel's filters are no longer kept between starts.
- A first-run tour (5 steps, in order: search, scrub, peek, filters, settings; each shown,
  then asked for, what to touch lit in place, the slider shown by a touch) and How It Works behind the "?" (`web/guide.ts`,
  `web/coach.ts`, `web/tour-shows.ts`, `web/hands.ts`).
  Guarded by `e2e/tour.spec.ts` (including a frame-by-frame smoothness check), the Playwright
  project `first-run`, which runs every other e2e test again with the tour on, and
  release.yml, which runs the tour's `@release` tests on the real word list.
- Coming back after Android kills the app (cheap phones do, in the background): the app
  keeps the search, scroll and open word as it goes to the background and restores them on
  the next start within 30 minutes (`web/place.ts`, `e2e/place.spec.ts`; the app only, a
  web page reload starts fresh). Released in v0.7.0 and v0.7.1 (kept as it changes); the
  low-RAM test (`tools/low-ram/`) on v0.6.3 showed it lost: rerun it on a release to confirm.
- README (2026-11-08): screenshots of the real app in `docs/screenshots/` (light and dark,
  taken on the released data); retake them when the look changes. The repo's About should
  read "A free, fully offline English dictionary that finds a word from any part of it."
  with the Pages link as its website (settings writes are blocked from agent sessions).
- Web app on Pages (ADR-0008, released in v0.7.0): the loading screen waits only for the
  starter (`<list>.starter.json`, ~93 KB gzipped); suggestions, peeks and word pages work at
  once; the word list comes gzipped (13.7 MB) behind it; a data worker then keeps every file
  on the device and a service worker keeps the page, so later visits work offline. Built by
  `tools/web-data.ts` when `DICTIONARIUS_WEB=1` (pages.yml); the APK is unchanged. Check on Pages that Range requests come back exact (206) and that Settings
  reaches "Saved on this device". `npm run test:e2e:built` tests the published build.
- Installable web app (ADR-0009, on main, unreleased): a manifest and icons (web build only),
  Install in Settings where the browser offers it; installed, it behaves like the Android app
  (Back word → results → start screen → out, place kept), decided in `web/shell.ts`; the service
  worker opens the kept page after 2 s on a weak signal. Also for every build: a light/dark switch
  at the top right of Settings (kept only when against the system's), and "Still downloading"
  with dots on a word's page whose definitions are on their way ("Still loading" in the app).
  The Android app's Back now steps through the same history (its clear-the-search case is gone).
  After the next release: install from Pages on a phone and check that Back closes Settings
  first, and in the Android app that a forced theme sets the status bar's icon colour.
- `/dictionarius/` (lowercase) needs the owner's user-site repo `smitravitz.github.io` with
  a redirecting `404.html` (given to the owner; not confirmed set up).

## Open items

1. ADR-0005: next, links and "plural of" as ids, then translations (French first). A
   core-only APK flavour is now possible (33.8 MB of definitions instead of 56.9).
2. The 102 MB installed vs 73.3 MB APK gap: get Android's storage breakdown (app/data/cache).
3. Whether the Android app should also wait behind the loading screen (currently no).
   On the phone, confirm reading in place (ADR-0005): `adb shell dumpsys meminfo
   io.github.smitravitz.dictionarius` should show about 57 MB less than v0.5.x, and a
   word page should still feel instant (Chromium: 85–97 ms for an uncached block).
4. Check the newer suggestion pieces in `web/examples.ts` against real word counts.
5. ADR-0006 gates: the `LTRS` letter column first, then the positions layer and the
   letter keyboard / pattern field.
6. ADR-0007 (planning only, nothing started): pronunciations for the 92.7% of words
   without one, worked out from their parts where measured safe; first step would be
   keeping the accent labels the builder drops.
