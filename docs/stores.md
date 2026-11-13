# Publishing to Google Play and the App Store

What the repository does for each store, and what only you can do, in each store's console.
The decisions behind it are in [ADR-0010](adr/0010-store-distribution.md). Store rules change
every year: the dates below were checked on 2026-11-12.

## Start these first: they take the longest

| What | Why it's slow |
|---|---|
| **Apple Developer Program** (US$99 a year). | Enrolment and identity checks can take days. |
| **Screenshots.** Both stores refuse a listing without them. | Run *Actions → Store screenshots → Run workflow* and download its `store-screenshots` artifact. |

## What's in the repository

| Store needs | Where | Checked by |
|---|---|---|
| Android app bundle (`.aab`), signed, targeting Android 16 (API 36, required since 31 August 2026) | `release.yml` builds it with every `v*` tag; it's that run's `play-app-bundle` artifact | CI builds a debug bundle; `scripts/check-bundle.sh` |
| iOS app, built with Xcode 26 (required since 28 April 2026) | `ios/`; `ios-release.yml` uploads every `v*` tag to App Store Connect once the secrets below are set | `ios.yml` builds it for the simulator |
| Privacy manifest, no permission prompts, export-compliance answer (`ITSAppUsesNonExemptEncryption`: no) | `ios/App/App/PrivacyInfo.xcprivacy`, `Info.plist` | `scripts/audit_privacy.py`, on every push |
| App data kept out of iCloud backups (the twin of Android's `allowBackup="false"`) | `ios/App/App/AppDelegate.swift` | `scripts/audit_privacy.py`; on a phone, see the list below |
| Listing text: name, descriptions, keywords | `fastlane/metadata/android/en-US/` (Play), `fastlane/metadata/en-US/` (App Store) | `test/store-listing.test.ts` holds each to its store's limit |
| Play's 512 px icon and 1024 × 500 feature graphic | `fastlane/metadata/android/en-US/images/` (the icon is `web/icons/maskable-512.png` without transparency; the graphic is `rsvg-convert docs/brand/feature-graphic.svg`) | the same test |
| Privacy policy, at a public address | [`PRIVACY.md`](../PRIVACY.md): `https://github.com/smitravitz/Dictionarius/blob/main/PRIVACY.md` | |
| Screenshots at each store's size | `playwright.store.config.ts`, the *Store screenshots* workflow | |

## Google Play, step by step

1. Create the app in [Play Console](https://play.google.com/console): name *Dictionarius*, app, free.
2. **App signing: decide before the first upload; it can't be changed after.**
   - *Give Play your own key* (Setup → App signing → use an existing key; the key is
     `~/.dictionarius/release.p12`, alias `dictionarius`): Play's copies and the APKs on
     GitHub carry the same signature, so a phone can update one over the other.
   - *Let Play make a key* (its default): Play's copies are signed differently, so someone
     who installed from GitHub or Obtainium must uninstall before installing from Play.
     Your key then only proves uploads are yours, and Play can replace it if it's lost.
3. Fill in *App content*:
   - Privacy policy: the address above.
   - Data safety: no data collected, no data shared.
   - Ads: none. App access: everything available without an account.
   - Content rating questionnaire: a reference app. The dictionary holds vulgar and
     offensive words, hidden until safe search is turned off in Settings; answer the
     language questions with that in mind.
   - Target audience: pick the ages you intend; choosing children brings Families rules.
4. Store listing: paste the three texts from `fastlane/metadata/android/en-US/`, upload
   `images/icon.png`, `images/featureGraphic.png` and the `google-play-phone` screenshots.
5. Push a release tag, download `play-app-bundle` from the run, and upload the `.aab` to
   the production track.
6. Later releases: upload each new `.aab` to production. (Uploading can be automated with a
   service account once the first release has been made by hand; not set up.)

## App Store, step by step

1. In [App Store Connect](https://appstoreconnect.apple.com), *Users and Access →
   Integrations → App Store Connect API*: make a **team key with the Admin role** (signing in
   Apple's cloud needs it) and download its `.p8` file once.
2. Add four secrets to the repository (Settings → Secrets and variables → Actions); their
   names and what goes in each are at the top of
   [`ios-release.yml`](../.github/workflows/ios-release.yml).
3. Register the bundle ID `io.github.smitravitz.dictionarius` (developer.apple.com →
   Identifiers), then create the app in App Store Connect with it: name *Dictionarius:
   Dictionary*, primary language English, SKU of your choice.
4. Run *Actions → iOS release → Run workflow* with the latest tag (or push a new tag). The
   build appears under TestFlight some minutes after the run ends. **This workflow has not
   run yet**: expect to fix something on its first run, most likely signing.
5. Install it from TestFlight on an iPhone and go through the list below.
6. Fill in the listing from `fastlane/metadata/en-US/`, the `app-store-iphone` screenshots,
   the privacy policy address, *App Privacy: Data Not Collected*, the age rating
   questionnaire (as for Play: mature words exist, behind safe search), and category
   *Reference*. Pick the build and submit for review.

### Check on a real iPhone before submitting

Nothing here has run on an iPhone yet. Two things come close, and both should be green
first: the browser tests in Safari's engine (`npm run test:e2e:safari`), and the app opened
in a simulated iPhone by `ios.yml`, whose `ios-simulator-screens` artifact shows the start
screen, a search and a word's page. Neither has a finger, a notch or a phone's memory limits.

- It opens dark, with no white flash, and the status bar's icons are light.
- A search shows results as you type; a word's page shows meanings, examples, origin and
  pronunciation at once (definitions are read in place, a block at a time).
- Holding a word peeks without iOS's own text-selection menu appearing; holding beside a
  word opens the slider, with a tick under the finger.
- Swiping steps through words; the navigation buttons work (an iPhone has no Back button).
- The keyboard doesn't zoom the page or cover the results; the notch and home bar are clear.
- A Wiktionary link opens in Safari, not inside the app.
- Leave the app, open others until iOS closes it, come back: it returns to where you were.
- With Airplane Mode on, everything still works.
- After an iCloud backup (Settings → your name → iCloud → iCloud Backup → Back Up Now),
  Dictionarius isn't among the apps with data in it (Manage Account Storage → Backups).

## The license and the App Store

Dictionarius's code is MPL-2.0 (since v0.7.5; earlier releases are offered under it too),
chosen so the app can be on the App Store with no exception to write: unlike the GPL, it
doesn't forbid the store's own terms on the copy people download, and contributions from
others come under the same license. The dictionary data is CC BY-SA 4.0, which forbids
adding technical restrictions to the *data*; it stays freely downloadable from this
repository's data releases. This is a summary, not legal advice.
