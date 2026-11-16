# Handoff: where the project stands

Read this first in a new chat, then `.claude/CLAUDE.md`. Update it at the end of any
session that changes what's below (newest state only; history lives in git).

_Last updated: 2026-11-16, at v0.7.6, the first release with a Play app bundle (its run's `play-app-bundle`) and the store work (ADR-0010); in no store yet. Next: Google Play's internal test track._

## What it is

Dictionarius: an offline, open-source English dictionary that finds a word from any part
of it. TypeScript web app (no framework, Vite 7) wrapped for Android and iOS with Capacitor 8.
Search is an FM-index in a Web Worker; definitions are a brotli-blocked file. Data is
built from the English Wiktionary dump by `scripts/build_fm_index.py`.

- Data formats: `docs/index-format.md`, `docs/definitions-format.md`
- Decisions: `docs/adr/` (ADR-0005, layered data packs: Proposed, its step 1 built;
  ADR-0006, letter and position conditions as bitmaps: Proposed; ADR-0009, the installable
  web app: Accepted; ADR-0010, Google Play and the App Store: Accepted, built, unpublished)
- Build, test, release: `docs/development.md`
- The stores, step by step: `docs/stores.md`

## Where things are

| Path | What |
|---|---|
| `src/` | Search engine, definitions reader, filters (runs in the worker; unit-tested) |
| `web/` | The page: `main.ts`, the worker `search-worker.ts`, the data worker `data-worker.ts`, gestures, loading screen `loader.ts`, service worker `sw.js`, which shell it runs in `shell.ts`, light/dark `theme.ts` (+ `theme-boot.js`), the web app's icons `icons/` |
| `tools/` | Vite steps: `web-data.ts` (starter, gzipped list), `web-app.ts` (manifest, icons, service worker), `theme-script.ts`; `make-icons.ts` draws `web/icons/` from `docs/brand/icon.svg` |
| `scripts/` | Python data pipeline, `setup-release.sh`, privacy audit |
| `e2e/` | Playwright tests (desktop + phone) against `test/fixtures` sample data; `e2e/built/` the published build, `e2e/live/` the Pages site itself |
| `android/` | Capacitor Android shell, `EdgeGesturesPlugin.java` |
| `ios/` | Capacitor iOS shell (Swift Package Manager), its privacy manifest; iPhone only, iOS 16+ |
| `fastlane/metadata/` | Store listings: Play (`android/en-US/`) and App Store (`en-US/`); `PRIVACY.md` is the policy they link to |
| `.github/workflows/` | `ci.yml`, `release.yml` (tag → signed APK and Play app bundle), `pages.yml` (web app on Pages), `ios.yml` (iOS builds), `ios-release.yml` (tag → TestFlight), `store-screenshots.yml` (by hand), `live-site.yml` (the Pages site in Chrome and Edge, after each deploy and by hand) |

## Shipping

- Release: `git tag -a vX.Y.Z -m "notes" && git push origin vX.Y.Z` (the owner pushes tags;
  sessions can't). Builds the signed APK, publishes the GitHub release, then starts
  `pages.yml` on main to put that version at https://smitravitz.github.io/Dictionarius/.
- Republish Pages without a release: Actions → Pages → Run workflow (it refuses a release
  from before the bad-connection check below).
- Before a release publishes, it checks the data opens with the tagged code and that 40
  randomly picked real words show their whole page, in a browser and in the app's mode
  (`e2e/word-page-sample.spec.ts`). Release and Pages both check, on the real word list,
  that on a slow, lossy or dead connection every part of a word's page arrives together and
  never loads for good, frame by frame, for each data file on its own, in no more than three
  requests per file (`e2e/word-page-network.spec.ts`; in CI on the fixture too). The Java that reads definitions in place runs on an
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

- Licenses: code MPL-2.0 since v0.7.5, and every earlier release is offered under it as well
  as GPL-3.0-or-later (README, "License"); data CC BY-SA 4.0; fonts SIL OFL 1.1. MPL was
  picked so the App Store needs no exception.
- Stores (ADR-0010): merged to `main`, in no store yet. CI builds the Play app bundle and
  the iOS app, runs the browser tests in Safari's engine, and opens the iOS app in a
  simulator. v0.7.6's release run has the first `play-app-bundle` (kept 90 days). The owner's
  Play developer account is new (November 2026), so Play's rule
  for personal accounts made after 13 November 2023 applies: a closed test with 12 testers
  opted in for 14 days running, then an application for production access. `ios-release.yml` has never run, and nothing has run on a real iPhone:
  the owner has none, so the first TestFlight build needs a borrowed iPhone or a tester.
- Latest release **v0.7.6** (2026-11-15), on the format-3 data pinned in
  `data/headwords.sha256` (a core file plus examples, etymology and pronunciation layers).
- Navigation buttons (back, home, forward) over the list and word pages, on by default on
  every device, a switch in Settings; the title (top left) also goes home. The funnel's filters
  are no longer kept between starts; Settings' switches are, and the installed app asks for
  persistent storage.
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
- Installable web app (ADR-0009, released in v0.7.2): a manifest and icons (web build only),
  Install in Settings where the browser offers it; installed, it behaves like the Android app
  (Back word → results → start screen → out, place kept, straight back to a word that was open),
  decided in `web/shell.ts`; once kept, the page opens from the device at once and a new build
  from the next start. Also for every build: a light/dark switch
  at the top right of Settings (dark by default everywhere; light kept once picked), and "Still downloading"
  with dots on a word's page whose definitions are on their way ("Still loading" in the app);
  with no network it says so instead, and fills in once the signal's back (ADR-0005, "On a
  phone's network"): definitions never load for ever.
  The Android app's Back now steps through the same history (its clear-the-search case is gone).
  After the next release: install from Pages on a phone and check that Back closes Settings
  first, and in the Android app that a forced theme sets the status bar's icon colour.
- `/dictionarius/` (lowercase) needs the owner's user-site repo `smitravitz.github.io` with
  a redirecting `404.html` (given to the owner; not confirmed set up).

- Reported 2026-11-16, on the live web app in Edge: the download bar stuck at 99% until a
  reload, and no definitions at all, reloads included. Not reproduced: nothing here could
  reach the Pages site or run Edge; a first visit in Chrome 153 (HTTP/1.1 and HTTP/2, a
  made-up 33 MB dictionary served as Pages serves, a word opened every second through the
  download) kept everything and filled in every page. Two ways to those screens were found
  and fixed, each with a test that failed first (branch `restart-stalled-download`,
  unreleased; the site only changes with a release):
  1. A background download that went quiet with no error was waited on for ever. It's now
     dropped after 3 s and started again (ADR-0008).
  2. A kept copy of a definitions file that was wrong (cut short, or not the file) was
     trusted: every word said "No definition", on every visit. It's now let go of and read
     from the network (`web/data-cache.ts`, `e2e/kept-copy.spec.ts`).
  A file let go of is kept again in the same visit, whichever worker got there first.
  `e2e/kept-copy.spec.ts` is left out of the Safari-engine run: Playwright's WebKit empties
  every Cache Storage store on a reload (measured with a store the app never touches;
  `playwright.config.ts` has the numbers), so no second visit can be tested there. Whether
  real Safari keeps the dictionary between visits is unchecked: add it to the iPhone checklist.
  Whether either was the report's cause isn't known. To find out: the console snippet in
  `docs/development.md` ("In your own browser") run in the owner's Edge, and the new
  "Live site" workflow (`live-site.yml`, `e2e/live/`; Chrome and Edge against Pages itself,
  after each Pages deploy and by hand), which has never run on GitHub: its Edge install step
  and its first results are unseen.

## Open items

0. **Stores (ADR-0010), first release as the app is; ADR-0005, 0006 and 0007 are not needed
   for it.** In order:
   1. Done: `store-ready` is merged, and the iOS app compiles and the bundle check passes in CI.
   2. **Next.** Google Play first, since the Android app is already proven on phones
      (`docs/stores.md`, steps 5 to 7): choose the app signing key (permanent) while making
      the first release, upload v0.7.6's `play-app-bundle` to the internal test track and
      try it on a phone with the Play Store (that Play's own APKs read definitions in place
      has only been checked by script), fill in the console forms, then the closed test
      (12 testers, 14 days: finding them is the slow part, start now), apply for production
      access, then production.
      Screenshots: `store-screenshots.yml` failed on its first run ("No tests found"):
      `tools/store-screenshots/screens.spec.ts` had never been committed, hidden by a
      `.gitignore` line. It's written now (branch `store-screenshots-spec`; CI runs it on
      the sample list); run the workflow once that's merged.
   3. Done: the two iOS checks are green on `main`. `npm run
      test:e2e:safari` runs the browser tests in Safari's engine at an iPhone's size (CI job
      "Browser tests (Safari's engine, iPhone)"; four files that drive Chromium's devtools
      are left out, `playwright.config.ts` says which), and `ios.yml`'s "iOS app runs in a
      simulator" opens the real app, searches and reads a word (`ios/SimulatorRun`), keeping a
      picture of each screen; it taps by on-screen position, since XCUITest can't work out
      where to tap inside a web view. Both were written with no WebKit, Mac or simulator to hand:
      what their first runs show is either a mistake in the test or a real iPhone bug, and
      each failure needs telling apart. The first runs found one of each kind, and a third:
      a tap on text that takes no focus left the keyboard up (a real bug, fixed by
      `web/tap-away.ts`); the tour's smoothness test timed the touch by the wrong frame, so
      uneven frames looked like jumps (the test); and the simulator run took the text in
      the search box for a result (the word was typed in full, so both are named alike) and
      tapped the box; it now takes the row below the box, and taps twice, since by the app's
      rule a tap on a word while typing only puts the keyboard away (the test).
   4. Apple, which can start alongside Play (enrolment takes days): the account, its key as
      four secrets, the first `ios-release.yml` run (expect signing to need a fix), then the
      iPhone checklist in `docs/stores.md`. Settle who runs that checklist, and on which
      iPhone, before paying for the program: the owner has no iPhone.
   Not built: iPad; uploads to the stores from CI. Undecided: Capacitor's iOS code ships as
   ionic-team's prebuilt framework (Swift Package Manager), not built from source (ADR-0010,
   open questions).
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
