# Dictionarius 📖

[![CI](https://github.com/smitravitz/dictionarius/actions/workflows/ci.yml/badge.svg)](https://github.com/smitravitz/dictionarius/actions/workflows/ci.yml)

Fully offline, open-source dictionary with **instant mid-word search** — find a word by any fragment, not just its prefix (`eren` → `serene`, `coherent`, `adherence`).

Powered by an **FM-index** (a compressed self-index where the search index *is* the data), so substring search over 1.3M+ words fits in a tiny footprint and runs with no server. Built to run as a web app / PWA and on iOS, Android, and F-Droid.

> ⚠️ Early development. The core search engine and data model are built and tested; the app shell and data pipeline are in progress.

## Why it's different

The open dictionary ecosystem (StarDict, Aard2, ZIM) does prefix/exact lookup over block-compressed data with a separate key index. Dictionarius instead makes **substring search *be* the storage** via an FM-index — measured **~2.3× smaller and faster than SQLite FTS5 trigram** on the same data, and projected smaller still with an engineered succinct index.

## How it stays small 🥔

- **Core (~16 MB download):** every headword searchable + full definitions for the top ~50k words by frequency (~100% of real lookups), fully offline on first run. The headword index for all 1,357,380 English search keys is measured at **12.4 MB download / 29.8 MB in memory** (including a 1.6 MB hot list that makes mid-word search instant); the core definitions (~5.7 MB) are still a projection.
- **Tail (on-demand):** rarer definitions fetch when tapped and cache locally, or pre-download the full set for total offline use.

See [`docs/adr/0001-frequency-tiered-gloss-storage.md`](docs/adr/0001-frequency-tiered-gloss-storage.md) for the reasoning and measured numbers.

## Status

- ✅ Platform-agnostic core (lookup, search, suggest, favorites, history) — test-driven, 81 unit tests plus browser tests on desktop and phone
- ✅ FM-index substring source + SQLite source, interchangeable behind one contract
- ✅ Headword index built from real Wiktionary data ([`scripts/build_fm_index.py`](scripts/build_fm_index.py), [format](docs/index-format.md)) and a zero-copy TypeScript loader — at full scale it opens in ~2 ms and answers exact, prefix and mid-word lookups in microseconds (Node/V8)
- ✅ Size & performance benchmarks ([`bench/`](bench/))
- ✅ Results in concordance order: the exact match, then words that start with your text, then words with 1 letter before it, then 2, and so on; at each position single words before hyphenated words before phrases, common words first. Worked out by walking the FM-index backwards one letter at a time, so the first page takes ~1–10 ms and counting every position ~3–90 ms (0.6 s for a single letter)
- ✅ Type-ahead dropdown (web): 50 results, then more load as you scroll; touch and mouse drag scrolling; every row aligned on the text you typed, and a row too long for the screen scrolls sideways. The summary counts words that start with, end with and contain your text. Hold a blank spot in the list and slide sideways (with a haptic tick per step) to jump to words with that many letters before your text; Alt+←/→ does the same from the keyboard. In Chromium on the full index: ready in ~0.3–0.7 s, keystroke to results ~33 ms (~35–135 ms with the CPU slowed 4× to mimic a mid-range phone)
- ✅ Settings (the cog, top right) with safe search, on by default: words whose main meaning Wiktionary labels vulgar or offensive, any word with a slur meaning at all, and their inflections stay out of the results unless typed in full ([rule](docs/index-format.md#safe-search))
- ✅ Android app (Capacitor): the same search, offline, with the full word list inside; signed APKs published on GitHub releases
- ⏳ Definitions store (core + on-demand tail)
- ⏳ Testing on real phones (the numbers above are an emulated phone)
- ⏳ PWA, iOS and F-Droid builds

## Install (Android)

Add `https://github.com/smitravitz/Dictionarius` to [Obtainium](https://obtainium.imranr.dev) to install it and get updates, or download the APK from the latest [release](https://github.com/smitravitz/Dictionarius/releases/latest). Definitions aren't in the app yet; it finds words and links each one to Wiktionary.

## Licensing

- **Code:** GPL-3.0-or-later ([`LICENSE`](LICENSE))
- **Dictionary data:** [Wiktionary](https://en.wiktionary.org), **CC-BY-SA 4.0** (+ GFDL). Bundled data is redistributed under the same license with attribution and modification notices — see [`data/README.md`](data/README.md).

## Development

```bash
npm install
npm test            # unit tests
npm run typecheck   # strict TypeScript check
npm run test:e2e    # browser tests (desktop + phone) on a small sample index

# Run the app on the full word list: build the index, then start the dev server
python scripts/build_fm_index.py path/to/raw-wiktextract-data.jsonl   # writes dist/headwords.bin
npm run dev
```

Android (needs Android Studio, or the Android SDK and JDK 21):

```bash
npm run build && npx cap sync android   # copy the web app and dist/headwords.bin into android/
npx cap open android                    # or: cd android && ./gradlew assembleDebug
```

**Releasing:** once, run `bash scripts/setup-release.sh path/to/headwords.bin` on your own computer. It creates the signing key, stores it in GitHub's Actions secrets and uploads the word index. After that, pushing a tag such as `v0.2.0` builds a signed APK and publishes it as a release ([`.github/workflows/release.yml`](.github/workflows/release.yml)).

Benchmarks (Python) live in [`bench/`](bench/) — see its README to reproduce every number above. Domain vocabulary is in [`CONTEXT.md`](CONTEXT.md); architecture decisions in [`docs/adr/`](docs/adr/).

Built with TypeScript; packaged for mobile with Capacitor.
