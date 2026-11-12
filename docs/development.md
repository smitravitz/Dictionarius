# Development

## Before your first commit

```bash
git config user.email "39315452+smitravitz@users.noreply.github.com"
git config core.hooksPath .githooks
```

The hooks in `.githooks/` stop a commit or push that links to a Claude chat, and a commit made
under any other email address (see `.claude/CLAUDE.md`). Claude sessions turn them on
themselves.

## Tests

```bash
npm install
npm test            # unit tests
npm run typecheck   # strict TypeScript check
npm run test:e2e    # browser tests (desktop + phone) on a small sample index
python -m unittest scripts/test_build_fm_index.py   # the index builder's safe-search rule and list
python scripts/audit_privacy.py                      # the code against privacy.toml (add --apk path/to.apk for a build)
```

## Run the app on the full word list

Build the index from the [Wiktionary download](https://kaikki.org/dictionary/rawdata.html), then start the dev server:

```bash
pip install -r scripts/requirements.txt
python scripts/build_fm_index.py path/to/raw-wiktextract-data.jsonl   # writes dist/headwords.bin
npm run dev
```

The build checks itself against brute force and also writes:

- `headwords.definitions.bin`: every word's meanings, by word id, and beside it one **layer** each for examples, etymology and pronunciation (`headwords.examples.bin`, `headwords.etymology.bin`, `headwords.pronunciation.bin`; [format](definitions-format.md), [ADR-0005](adr/0005-layered-data-packs.md)). Only a build from the dump has them; the app reads the files beside the index, and shows what there is when a layer is left out. A version-2 file (everything in one, before v0.6) upgrades without the dump: `python scripts/upgrade_definitions.py dist/headwords.definitions.bin`.
- `headwords.golden.json`: answers the tests compare against
- `headwords.safe-review.tsv`: every word safe search hides, and visible words worth a look, most common first, with why. Corrections go in the hand-picked list, `data/safe-search.list` (encoded; `python scripts/safe_search_list.py show`, `add`, `remove`; quote phrases). See the [rule](index-format.md#safe-search). To check an outside bad-word list (such as cuss) against what safe search shows: `npx vite-node scripts/safe-search-candidates.ts list.txt`
- `headwords.labels.jsonl.gz`: the labels safe search reads, and which words are names (proper nouns). With it and a list of the headwords, a rule change rebuilds without re-reading the dump: `python scripts/build_fm_index.py words.json --labels headwords.labels.jsonl.gz`. A cache from before names were kept has no parts of speech; an index rebuilt from it has no `NAME` column, so the app doesn't offer *Disable names* until the next build from the dump. Definitions aren't in the cache: a rebuild from it writes none.

To measure how the definitions pack, without the whole dump: `python scripts/sample_definitions.py raw-wiktextract-data.jsonl` (every 20th word, a few MB), then `python bench/definitions_packing.py definitions-sample.jsonl.gz` ([ADR-0004](adr/0004-all-definitions-bundled.md)). What each kind of content costs on its own, on a real version-2 file: `python bench/layer_split.py headwords.definitions.bin` (ADR-0005). Words without a pronunciation, one per line: `npx vite-node scripts/missing-pronunciations.ts dist/headwords.bin missing-pronunciations.txt` (add `--tsv words.tsv` for every word's pronunciations, etymologies and base words; `python bench/pronunciation_glue.py words.tsv` measures how often gluing parts' pronunciations is right).

**Releasing new data:** `data/headwords.sha256` lists every data file an app release bundles, with its checksum; the upload and the release workflow both go by it. From the build's folder: `shasum -a 256 headwords.bin headwords.definitions.bin headwords.examples.bin headwords.etymology.bin headwords.pronunciation.bin > data/headwords.sha256`, commit and push, then `bash scripts/setup-release.sh dist/headwords.bin` uploads them all as a `data-…` release that app releases are built with. The release workflow checks the data opens with the tagged code before building (`DICTIONARIUS_RELEASE_DATA`).

## Android

Needs Android Studio, or the Android SDK and JDK 21. The app is packaged with [Capacitor](https://capacitorjs.com).

The app asks for no permissions, and [`privacy.toml`](../privacy.toml) says so; CI fails if a build requests one. Capacitor's template and many plugins add permissions (INTERNET, VIBRATE), so check a new plugin's manifest before adding it. The haptic tick comes from a small local plugin, [`plugins/haptic-tick`](../plugins/haptic-tick), that needs none.

```bash
npm run build && npx cap sync android   # copy the web app and dist/headwords.bin into android/
npx cap open android                    # or: cd android && ./gradlew assembleDebug
```

## iOS

Needs a Mac with Xcode 26 or later to build or run it; without one, CI does both
([`ios.yml`](../.github/workflows/ios.yml) builds it for the simulator, [`ios-release.yml`](../.github/workflows/ios-release.yml)
sends a release to TestFlight). The project in `ios/` is Capacitor's, with Swift Package
Manager; `npx cap sync ios` works on any system and rewrites `ios/App/CapApp-SPM/Package.swift`
when a plugin is added or removed (commit it; CI fails if it's stale).

```bash
npm run build && npx cap sync ios   # copy the web app and the word list into ios/
npx cap open ios                    # on a Mac: opens Xcode
```

The app asks for nothing: no `NS…UsageDescription` keys, and a privacy manifest
(`ios/App/App/PrivacyInfo.xcprivacy`) that says no tracking and no collected data. The
privacy audit checks both against `privacy.toml`. Its icon is drawn by `tools/make-icons.ts`.

## The stores

[`docs/stores.md`](stores.md): what Google Play and the App Store each need, what the
repository already does, and the steps only the owner can take in each console. The store
listings are in `fastlane/metadata/`; `npm test` holds them to each store's length limits.
Store screenshots: Actions → Store screenshots → Run workflow, or
`DICTIONARIUS_SAMPLE_DATA=release-data npx playwright test --config playwright.store.config.ts`.

### The web app as published

`npm run test:e2e:built` builds the web app as `pages.yml` does (`DICTIONARIUS_WEB=1`: each
word list's starter and gzipped copy, the service worker, the manifest and icons) and tests it
served as Pages serves it: that it opens from the starter, works offline after one visit
(ADR-0008), that Chrome finds it installable, and that once kept it opens from the device at
once, a new build from the next start (ADR-0009). CI runs it after the main browser tests. A plain `npm run build` (the Android
app's) leaves these out.

The web app's icons (`web/icons/`) are drawn from `docs/brand/icon.svg`; after changing it,
run `node tools/make-icons.ts` and commit what it writes (a unit test fails until you do).

Browser tests run the page as each app with `asTheApp(page)` (the Android app) or
`asInstalled(page)` (the web app installed; it answers `(display-mode: standalone)`, which
Chromium can't emulate) from `e2e/as-the-app.ts`.

### On a low-memory phone (Docker)

`tools/low-ram/` tests a release on an emulated cheap phone, 2 GB then 1.5 GB of memory
and 2 cores, inside Docker. Needs Docker, an x86_64 machine and KVM (`/dev/kvm`, on when
virtualisation is enabled in the BIOS); nothing else is installed on your machine.

```bash
bash tools/low-ram/run.sh                       # the newest release
APK_TAG=v0.6.3 RAM_SIZES="1024" bash tools/low-ram/run.sh   # a given release, a given size
APK=path/to/app.apk bash tools/low-ram/run.sh   # an APK of your own
```

The first run builds the image (about 2 GB downloaded). Each size gets a fresh phone; the
app gets a cold start, a search, a filmed scroll, a word opened, memory pressure, a kill in
the background (`kill -9`, as Android's low-memory killer does), with animations off so the
screen can be read every couple of seconds. ("Don't keep activities" was dropped: set from
adb it never took effect.) `low-ram-results/summary.txt` is the one file
to read or send: the host, Android and WebView versions; each start's LaunchState (COLD,
WARM, HOT) and time; the start filmed as text every 2 s (search field, word count, loading);
whether each search typed; scroll frame stats; memory of the app, the WebView's renderer and
what the phone has left at four points; whether the app came back to the same page after the
kill, and how soon; crashes with their first lines; and a timeline of every step. Screenshots,
each screen's text (`.xml`), the scroll video and the log are beside it. Timings run on your PC's CPU with
software graphics, so they flatter or understate a real phone; memory is the figure to trust.

## Releasing

Once, on your own computer: `bash scripts/setup-release.sh path/to/headwords.bin`. It creates the signing key, stores it in GitHub's Actions secrets and uploads the word index. After that, pushing a tag such as `v0.2.0` builds a signed APK and publishes it as a release ([`release.yml`](../.github/workflows/release.yml)), keeps the same build as an app bundle for Google Play (the run's `play-app-bundle` artifact), sends the iOS app to TestFlight once Apple's secrets are set ([`ios-release.yml`](../.github/workflows/ios-release.yml)), then publishes that version's web app to GitHub Pages ([`pages.yml`](../.github/workflows/pages.yml); only the latest release is online; once, set Settings → Pages → Source to **GitHub Actions**). To republish without a new release, run Actions → Pages → Run workflow (the latest release by default, or name a tag). The build names its files relative to the page (`base: "./"` in `vite.config.ts`), so it works from Pages' `/Dictionarius/` folder as well as inside the app. The release notes are the tag's message, so make it an annotated tag: `git tag -a v0.2.0 -m "What's new"` (several `-m` make several paragraphs; `-F notes.md` reads a file).

## More

- Benchmarks (Python): [`bench/`](../bench/); its README reproduces every number in the main README
- Domain vocabulary: [`CONTEXT.md`](../CONTEXT.md)
- Architecture decisions: [`docs/adr/`](adr/)
