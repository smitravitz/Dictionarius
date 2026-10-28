# Dictionarius 📖

[![CI](https://github.com/smitravitz/dictionarius/actions/workflows/ci.yml/badge.svg)](https://github.com/smitravitz/dictionarius/actions/workflows/ci.yml)

Fully offline, open-source dictionary with **instant mid-word search** — find a word by any fragment, not just its prefix (`eren` → `serene`, `coherent`, `adherence`).

Powered by an **FM-index** (a compressed self-index where the search index *is* the data), so substring search over 1.3M+ words fits in a tiny footprint and runs with no server. Written in TypeScript; runs as a web app and as an Android app (packaged with [Capacitor](https://capacitorjs.com)), with PWA, iOS and F-Droid builds planned.

> ⚠️ Early development. Search works on the web and Android; definitions are next.

## Why it's different

The open dictionary ecosystem (StarDict, Aard2, ZIM) does prefix/exact lookup over block-compressed data with a separate key index. Dictionarius instead makes **substring search *be* the storage** via an FM-index — measured **~2.3× smaller and faster than SQLite FTS5 trigram** on the same data, and projected smaller still with an engineered succinct index.

## How it stays small 🥔

- **Core (~16 MB download):** every headword searchable + full definitions for the top ~50k words by frequency (~100% of real lookups), fully offline on first run. The headword index for all 1,357,380 English search keys is measured at **12.4 MB download / 29.8 MB in memory** (including a 1.6 MB hot list that makes mid-word search instant); the core definitions (~5.7 MB) are still a projection.
- **Tail (a data pack you add):** the rarer definitions come as one file. The app opens its download link in your browser, and you import the file; the app itself never connects ([ADR-0002](docs/adr/0002-offline-only-data-packs.md), proposed).

See [`docs/adr/0001-frequency-tiered-gloss-storage.md`](docs/adr/0001-frequency-tiered-gloss-storage.md) for the reasoning and measured numbers.

## Status

**🔎 Search engine**

- ✅ FM-index over all 1,357,380 English search keys from Wiktionary ([builder](scripts/build_fm_index.py), [format](docs/index-format.md)), with a zero-copy TypeScript loader
- ✅ Opens in ~2 ms; exact, prefix and mid-word lookups in microseconds (Node/V8)
- ✅ Results in concordance order:
  1. the exact match
  2. words that start with your text
  3. words with 1 letter before it, then 2, and so on
  - at each position: single words, then hyphenated words, then phrases; common words first
- ✅ First page in ~1–10 ms; every position counted in ~3–90 ms (0.6 s for a single letter)
- ✅ Benchmarked against SQLite FTS5 trigram ([`bench/`](bench/)); both work as sources behind one contract
- ✅ Platform-agnostic core (lookup, search, suggest, favorites, history), test-driven: unit tests, plus browser tests on desktop and phone

**📱 App**

- ✅ Type-ahead list that loads more as you scroll; every row lines up on your text, and long rows scroll sideways
- ✅ Summary: how many words start with, end with and contain your text
- ✅ Position scrubber: hold a blank spot in the list and slide sideways (a haptic tick per step) to jump to words with that many letters before your text; Alt+←/→ on a keyboard
- ✅ Safe search (⚙️ Settings, on by default): hides vulgar words and slurs unless you type them out in full ([rule](docs/index-format.md#safe-search))
- ✅ Speed in Chromium on the full index: ready in ~0.3–0.7 s; keystroke to results ~33 ms (~35–135 ms with the CPU slowed 4× to mimic a mid-range phone)
- ✅ Android app with the full word list inside; signed APKs on GitHub releases
- ✅ No permissions at all: no network, storage or sensors, and nothing leaves your phone. The haptic tick uses the platform's built-in feedback, which needs none. CI checks every APK against [`privacy.toml`](privacy.toml)

**⏳ Next**

- Definitions: the core inside the app, the rest as an importable data pack
- Testing on real phones (the phone timings above are emulated)
- PWA, iOS and F-Droid builds

## Install (Android)

Add `https://github.com/smitravitz/Dictionarius` to [Obtainium](https://obtainium.imranr.dev) to install it and get updates, or download the APK from the latest [release](https://github.com/smitravitz/Dictionarius/releases/latest). Definitions aren't in the app yet; it finds words and links each one to Wiktionary.

## Licensing

- **Code:** GPL-3.0-or-later ([`LICENSE`](LICENSE))
- **Dictionary data:** [Wiktionary](https://en.wiktionary.org), **CC-BY-SA 4.0** (+ GFDL). Bundled data is redistributed under the same license with attribution and modification notices — see [`data/README.md`](data/README.md).

## Contributing

Test-driven TypeScript: `npm install && npm test`. [`docs/development.md`](docs/development.md) covers browser tests, building the word index, the Android app and releases.
