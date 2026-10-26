# Dictionarily 📖

[![CI](https://github.com/smitravitz/dictionarily/actions/workflows/ci.yml/badge.svg)](https://github.com/smitravitz/dictionarily/actions/workflows/ci.yml)

Fully offline, open-source dictionary with **instant mid-word search** — find a word by any fragment, not just its prefix (`eren` → `serene`, `coherent`, `adherence`).

Powered by an **FM-index** (a compressed self-index where the search index *is* the data), so substring search over 1.3M+ words fits in a tiny footprint and runs with no server. Built to run as a web app / PWA and on iOS, Android, and F-Droid.

> ⚠️ Early development. The core search engine and data model are built and tested; the app shell and data pipeline are in progress.

## Why it's different

The open dictionary ecosystem (StarDict, Aard2, ZIM) does prefix/exact lookup over block-compressed data with a separate key index. Dictionarily instead makes **substring search *be* the storage** via an FM-index — measured **~2.3× smaller and faster than SQLite FTS5 trigram** on the same data, and projected smaller still with an engineered succinct index.

## How it stays small 🥔

- **Core (~15 MB):** every headword searchable + full definitions for the top ~50k words by frequency (~100% of real lookups), fully offline on first run.
- **Tail (on-demand):** rarer definitions fetch when tapped and cache locally, or pre-download the full set for total offline use.

See [`docs/adr/0001-frequency-tiered-gloss-storage.md`](docs/adr/0001-frequency-tiered-gloss-storage.md) for the reasoning and measured numbers.

## Status

- ✅ Platform-agnostic core (lookup, search, suggest, favorites, history) — test-driven, 32 passing tests
- ✅ FM-index substring source + SQLite source, interchangeable behind one contract
- ✅ Size & performance benchmarks ([`bench/`](bench/))
- ⏳ Real Wiktionary/Kaikki ingest pipeline
- ⏳ Browser-runtime validation at full scale
- ⏳ App UI (Capacitor) for web / PWA / iOS / Android / F-Droid

## Licensing

- **Code:** GPL-3.0-or-later ([`LICENSE`](LICENSE))
- **Dictionary data:** [Wiktionary](https://en.wiktionary.org), **CC-BY-SA 4.0** (+ GFDL). Bundled data is redistributed under the same license with attribution and modification notices — see [`data/README.md`](data/README.md).

## Development

```bash
npm install
npm test            # run the suite
npm run typecheck   # strict TypeScript check
```

Benchmarks (Python) live in [`bench/`](bench/) — see its README to reproduce every number above. Domain vocabulary is in [`CONTEXT.md`](CONTEXT.md); architecture decisions in [`docs/adr/`](docs/adr/).

Built with TypeScript; packaged for mobile with Capacitor.
