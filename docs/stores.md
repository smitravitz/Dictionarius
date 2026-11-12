# Publishing to Google Play and the App Store

What the repository does for each store, and what only you can do, in each store's console.
The decisions behind it are in [ADR-0010](adr/0010-store-distribution.md). Store rules change
every year: the dates below were checked on 2026-11-12.

## Start these first: they take weeks

| What | Why it's slow |
|---|---|
| **Google Play: 12 testers for 14 days.** A personal developer account made after 13 November 2023 can't publish to production until a closed test has had at least 12 testers opted in for 14 days running. | Finding 12 people, then two weeks, then Google's review of the request. An organisation account is exempt but needs a D-U-N-S number, which also takes weeks. |
| **Apple Developer Program** (US$99 a year). | Enrolment and identity checks can take days. |
| **Screenshots.** Both stores refuse a listing without them. | Run *Actions → Store screenshots → Run workflow* and download its `store-screenshots` artifact. |

## What's in the repository

| Store needs | Where | Checked by |
|---|---|---|
| Android app bundle (`.aab`), signed, targeting Android 16 (API 36, required since 31 August 2026) | `release.yml` builds it with every `v*` tag; it's that run's `play-app-bundle` artifact | CI builds a debug bundle; `scripts/check-bundle.sh` |
| iOS app, built with Xcode 26 (required since 28 April 2026) | `ios/`; `ios-release.yml` uploads every `v*` tag to App Store Connect once the secrets below are set | `ios.yml` builds it for the simulator |
| Privacy manifest, no permission prompts, export-compliance answer (`ITSAppUsesNonExemptEncryption`: no) | `ios/App/App/PrivacyInfo.xcprivacy`, `Info.plist` | `scripts/audit_privacy.py`, on every push |
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
5. Push a release tag, download `play-app-bundle` from the run, and upload the `.aab` to a
   **closed testing** track. Invite 12 testers; after 14 days apply for production access.
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

Nothing here has run on an iPhone yet. The iOS app is the same page as the Android app, but
in Safari's engine, which the browser tests don't cover.

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

## The license and the App Store

Dictionarius's code is GPL-3.0-or-later, and the App Store's terms add restrictions the GPL
doesn't allow a *licensee* to add; that is why VLC was withdrawn in 2011. A copyright holder
isn't bound by their own license, so while every line is yours, you can publish it there.
Before accepting someone else's code, either get their agreement to App Store distribution
or add an App Store exception to the license. The dictionary data is CC BY-SA 4.0, which
forbids adding technical restrictions to the *data*; it stays freely downloadable from this
repository's data releases. This is a summary, not legal advice.
