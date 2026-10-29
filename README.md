# Dictionarius 📖

[![CI](https://github.com/smitravitz/dictionarius/actions/workflows/ci.yml/badge.svg)](https://github.com/smitravitz/dictionarius/actions/workflows/ci.yml)

Fully offline, open-source dictionary with **instant mid-word search** — find a word by any fragment, not just its prefix (`eren` → `serene`, `coherent`, `adherence`).

Powered by an **FM-index** (a compressed self-index where the search index *is* the data), so substring search over 1.3M+ words fits in a tiny footprint and runs with no server. Written in TypeScript; runs as a web app and as an Android app (packaged with [Capacitor](https://capacitorjs.com)), with PWA, iOS and F-Droid builds planned.

> ⚠️ Early development. Search works on the web and Android; definitions arrive with the next data build.

## Why it's different

The open dictionary ecosystem (StarDict, Aard2, ZIM) does prefix/exact lookup over block-compressed data with a separate key index. Dictionarius instead makes **substring search *be* the storage** via an FM-index — measured **~2.3× smaller and faster than SQLite FTS5 trigram** on the same data, and projected smaller still with an engineered succinct index.

## How it stays small

- **Every word, offline, from the first run:** the headword index for all 1,357,380 English search keys is 31 MB on disk (~13 MB zipped in the APK), including a hot list that makes mid-word search instant.
- **Every definition inside the app (43 MB):** meanings, usage labels, links between words, pronunciation and etymology for all ~1.5 million entries (one short example per meaning adds an estimated ~13 MB from the next data build), packed small (link glosses as templates, words and word classes as numbers) and compressed with brotli in blocks of 4,096 words, so opening a word unpacks one block. That is within ~11% of compressing it all as one stream, measured on a 5% sample ([ADR-0004](docs/adr/0004-all-definitions-bundled.md)).

Nothing is downloaded later; the app has no network permission at all.

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
- ✅ Benchmarked against SQLite FTS5 trigram ([`bench/`](bench/))
- ✅ Platform-agnostic core (search, filters, definitions, favorites, history), test-driven: unit tests, plus browser tests on desktop and phone

**📱 App**

- ✅ Type-ahead list that loads more as you scroll; every row lines up on your text, and long rows scroll sideways
- ✅ Summary: how many words start with, end with and contain your text
- ✅ Position scrubber: hold a blank spot in the list and slide sideways (a haptic tick per step) to jump to words with that many letters before your text; Alt+←/→ on a keyboard
- ✅ Safe search (⚙️ Settings, on by default): hides vulgar words and slurs, even typed out in full ([rule](docs/index-format.md#safe-search))
- ✅ Common words only by default: phrases and names (proper nouns) are switched off in ⚙️ Settings
- ✅ Word length filter: two roller wheels (min, max) in the filter panel under ⚙️; drag to turn ([how filters work](docs/adr/0003-filters-from-word-columns.md))
- ✅ Definitions: tap a word for its meanings, a short example of each in use, its pronunciation and a brief origin; long pronunciations and origins fold behind *more*; words inside a definition open their own entries, as on Wiktionary ([format](docs/definitions-format.md))
- ✅ Swipe sideways to step back and forward through the words you followed; Back goes straight to the results, and a swipe from there takes you down the same trail again
- ✅ Peek: hold a word in the results to see its first meanings; let go and it's gone
- ✅ Speed in Chromium on the full index: ready in ~0.3–0.7 s; keystroke to results ~33 ms (~35–135 ms with the CPU slowed 4× to mimic a mid-range phone)
- ✅ Android app with the full word list inside; signed APKs on GitHub releases
- ✅ No permissions at all: no network, storage or sensors, and nothing leaves your phone. The haptic tick uses the platform's built-in feedback, which needs none. CI checks every APK against [`privacy.toml`](privacy.toml)

**⏳ Next**

- Examples in a release: the builder and app are done; the next data build adds them
- Etymology section: each origin shown with the word classes it belongs to (today only a word with one origin shows it, as a brief)
- Testing on real phones (the phone timings above are emulated)
- PWA, iOS and F-Droid builds

## Install (Android)

Add `https://github.com/smitravitz/Dictionarius` to [Obtainium](https://obtainium.imranr.dev) to install it and get updates, or download the APK from the latest [release](https://github.com/smitravitz/Dictionarius/releases/latest). Until the first build with definitions is released, it finds words and links each one to Wiktionary.

## Licensing

- **Code:** GPL-3.0-or-later ([`LICENSE`](LICENSE))
- **Dictionary data:** [Wiktionary](https://en.wiktionary.org), **CC-BY-SA 4.0** (+ GFDL). Bundled data is redistributed under the same license with attribution and modification notices — see [`data/README.md`](data/README.md).

## Contributing

Test-driven TypeScript: `npm install && npm test`. [`docs/development.md`](docs/development.md) covers browser tests, building the word index, the Android app and releases.
