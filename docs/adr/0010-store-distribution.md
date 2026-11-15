# ADR-0010: One build for every shelf: Google Play and the App Store beside GitHub

- **Status:** Accepted; built 2026-11-12, not yet published to either store
- **Date:** 2026-11-12
- **Deciders:** project owner
- **Builds on:** [ADR-0004](0004-all-definitions-bundled.md) (everything inside the app),
  [ADR-0009](0009-installable-web-app.md) (one app, whatever shell it runs in)
- **Related:** `ios/`, `capacitor.config.ts`, `.github/workflows/release.yml`,
  `ios.yml`, `ios-release.yml`, `store-screenshots.yml`, `scripts/check-bundle.sh`,
  `scripts/audit_privacy.py`, `fastlane/metadata/`, `PRIVACY.md`, `docs/stores.md`,
  `test/store-listing.test.ts`, `test/web-app.test.ts`

## Context and problem statement

Dictionarius shipped as a signed APK on GitHub and a web app on Pages. Most people get apps
from Google Play and the App Store. The first store release goes out with the app as it is:
layered data (ADR-0005), letter search (ADR-0006) and derived pronunciations (ADR-0007) wait.

## Decision drivers

- One codebase and one release tag: a store build is the same web build in another wrapper.
- The privacy budget (`privacy.toml`) holds on every shelf, and a build checks it.
- The owner has no Mac: the iOS app must build, sign and upload from CI.
- Nothing a store makes permanent is decided by accident.

## Considered options

1. **Capacitor's iOS shell, an app bundle from the same Gradle build, listings in the
   repository** (chosen).
2. Stores later, after ADR-0005's smaller build: a smaller download, but months more with no
   store presence, and the store's own waiting periods would only start then.
3. The installed web app (ADR-0009) as the iPhone answer: no review and no fee, but people
   look for apps in the store, not in Safari's Share menu.

## Decision

- **iOS: Capacitor's shell with Swift Package Manager**, the same `build/web` as Android.
  No native code of ours beyond the haptic plugin: Capacitor's iOS server answers Range
  requests exactly (`WebViewAssetHandler.swift`), so definitions are read in place without
  an iOS twin of `RangedAssets.java`.
- **iPhone only, iOS 16 or later.** iPad support can be added in an update; Apple doesn't
  let an app drop a device once shipped. iOS 16 is the oldest Safari Vite 7 builds for.
- **Google Play gets an app bundle** built in the same Gradle run and signed with the same
  key as the APK. Whether Play signs its copies with that key or its own is the owner's
  choice at first upload (`docs/stores.md`): it decides whether a GitHub install can update
  to a Play one.
- **Versions come from the tag on every shelf:** `v1.2.3` is version 1.2.3, build 10203.
- **The iOS privacy budget is checked in what the app declares** (usage keys, the privacy
  manifest, App Transport Security), since iOS has no permission list to read from a build.
- **Listings live in `fastlane/metadata/`**, where fastlane and F-Droid both look, held to
  each store's limits by a test. No fastlane itself: uploads are by hand until that hurts.
- **iOS signing happens in Apple's cloud** with an App Store Connect key in the repository's
  secrets; without the key the workflow does nothing.

## Consequences

- A release tag now makes three things: the APK (GitHub), the bundle (Play, uploaded by
  hand) and the iOS build (TestFlight, submitted by hand).
- The iOS app runs in Safari's engine. The browser tests run there too (`npm run
  test:e2e:safari`) and CI opens the app in a simulator (`ios/SimulatorRun`), but the first
  TestFlight build must still be checked on a phone (`docs/stores.md`).
- The code's license (MPL-2.0 since v0.7.5) fits the App Store's terms as it is
  (`docs/stores.md`, "The license and the App Store").
- F-Droid can read the same listing folder when that build is made.

## Evidence

- Unit tests: `scripts/test_audit_privacy.py` (iOS checks), `test/store-listing.test.ts`,
  `test/web-app.test.ts` (launch colour, icon).
- `npx cap add ios` and `npx cap sync ios` run on Linux; the Xcode project has not been
  compiled yet (`ios.yml` is its first build), and `ios-release.yml` has not run.

## Open questions

- Capacitor arrives through Swift Package Manager as a prebuilt framework (checksummed,
  from ionic-team's GitHub releases), not built from the source in `node_modules`. Its
  source is MIT and was read for this decision, but what ships is the binary. CocoaPods
  would build it from source; it is the owner's call whether that is worth a second
  package manager.
- The four browser-test files that drive gestures through Chromium's devtools don't run in
  Safari's engine: swipes, the slider and the dropdown are untested there.
- iPad, with its own screenshots and all four orientations.
- Uploading to Play and submitting to Apple from CI.
