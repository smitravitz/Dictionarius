# Dictionarily 📖

[![CI](https://github.com/smitravitz/dictionarily/actions/workflows/ci.yml/badge.svg)](https://github.com/smitravitz/dictionarily/actions/workflows/ci.yml)

Fully offline, open-source dictionary with **instant mid-word search** — find a word by any fragment, not just its prefix (`eren` → `serene`, `coherent`, `adherence`).

Powered by an **FM-index** (a compressed self-index where the search index *is* the data), so substring search over 1.3M+ words fits in a tiny footprint and runs with no server. Built to run as a web app / PWA and on iOS, Android, and F-Droid.

> ⚠️ Early development. The core search engine and data model are built and tested; the app shell and data pipeline are in progress.

## Why it's different

The open dictionary ecosystem (StarDict, Aard2, ZIM) does prefix/exact lookup over block-compressed data with a separate key index. Dictionarily instead makes **substring search *be* the storage** via an FM-index — measured **~2.3× smaller and faster than SQLite FTS5 trigram** on the same data, and projected smaller still with an engineered succinct index.

## How it stays small 🥔

- **Core (~16 MB download):** every headword searchable + full definitions for the top ~50k words by frequency (~100% of real lookups), fully offline on first run. The headword index for all 1,357,380 English search keys is measured at **12.4 MB download / 29.0 MB in memory** (including a 2.2 MB hot list that makes mid-word search instant); the core definitions (~5.7 MB) are still a projection.
- **Tail (on-demand):** rarer definitions fetch when tapped and cache locally, or pre-download the full set for total offline use.

See [`docs/adr/0001-frequency-tiered-gloss-storage.md`](docs/adr/0001-frequency-tiered-gloss-storage.md) for the reasoning and measured numbers.

## Status

- ✅ Platform-agnostic core (lookup, search, suggest, favorites, history) — test-driven, 81 unit tests plus browser tests on desktop and phone
- ✅ FM-index substring source + SQLite source, interchangeable behind one contract
- ✅ Headword index built from real Wiktionary data ([`scripts/build_fm_index.py`](scripts/build_fm_index.py), [format](docs/index-format.md)) and a zero-copy TypeScript loader — at full scale it opens in ~2 ms and answers exact, prefix and mid-word lookups in microseconds (Node/V8)
- ✅ Size & performance benchmarks ([`bench/`](bench/))
- ✅ Ranked, lazily paged results: exact match first, then common words first, with words that start with your text given a head start; first page in ~1 ms at full scale (p99 4 ms)
- ✅ Type-ahead dropdown (web): 50 results, then more load as you scroll; touch and mouse drag scrolling; every row aligned on the text you typed. In Chromium on the full index: ready in ~0.8 s, keystroke to results ~35 ms (~60–100 ms with the CPU slowed 4× to mimic a mid-range phone)
- ⏳ Definitions store (core + on-demand tail)
- ⏳ Testing on real phones (the numbers above are an emulated phone)
- ⏳ App UI (Capacitor) for web / PWA / iOS / Android / F-Droid

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

Benchmarks (Python) live in [`bench/`](bench/) — see its README to reproduce every number above. Domain vocabulary is in [`CONTEXT.md`](CONTEXT.md); architecture decisions in [`docs/adr/`](docs/adr/).

Built with TypeScript; packaged for mobile with Capacitor.
