# Development

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
python scripts/build_fm_index.py path/to/raw-wiktextract-data.jsonl   # writes dist/headwords.bin
npm run dev
```

The build checks itself against brute force and also writes:

- `headwords.golden.json`: answers the tests compare against
- `headwords.safe-review.tsv`: every word safe search hides, and visible words worth a look, most common first, with why. Corrections go in the hand-picked list, `data/safe-search.list` (encoded; `python scripts/safe_search_list.py show`, `add`, `remove`; quote phrases). See the [rule](index-format.md#safe-search). To check an outside bad-word list (such as cuss) against what safe search shows: `npx vite-node scripts/safe-search-candidates.ts list.txt`
- `headwords.labels.jsonl.gz`: the labels safe search reads. With it and a list of the headwords, a rule change rebuilds without re-reading the dump: `python scripts/build_fm_index.py words.json --labels headwords.labels.jsonl.gz`

## Android

Needs Android Studio, or the Android SDK and JDK 21. The app is packaged with [Capacitor](https://capacitorjs.com).

The app asks for no permissions, and [`privacy.toml`](../privacy.toml) says so; CI fails if a build requests one. Capacitor's template and many plugins add permissions (INTERNET, VIBRATE), so check a new plugin's manifest before adding it. The haptic tick comes from a small local plugin, [`plugins/haptic-tick`](../plugins/haptic-tick), that needs none.

```bash
npm run build && npx cap sync android   # copy the web app and dist/headwords.bin into android/
npx cap open android                    # or: cd android && ./gradlew assembleDebug
```

## Releasing

Once, on your own computer: `bash scripts/setup-release.sh path/to/headwords.bin`. It creates the signing key, stores it in GitHub's Actions secrets and uploads the word index. After that, pushing a tag such as `v0.2.0` builds a signed APK and publishes it as a release ([`release.yml`](../.github/workflows/release.yml)). The release notes are the tag's message, so make it an annotated tag: `git tag -a v0.2.0 -m "What's new"` (several `-m` make several paragraphs; `-F notes.md` reads a file).

## More

- Benchmarks (Python): [`bench/`](../bench/); its README reproduces every number in the main README
- Domain vocabulary: [`CONTEXT.md`](../CONTEXT.md)
- Architecture decisions: [`docs/adr/`](adr/)
