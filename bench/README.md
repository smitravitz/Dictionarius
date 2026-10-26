# Benchmarks

Reproducible measurements behind Dictionarily's design decisions. Nothing in
this folder ships in the app.

## Run them

```bash
pip install -r bench/requirements.txt
bash bench/fetch_data.sh          # downloads datasets into bench/data/ (git-ignored)
python bench/fmbench.py           # any script below
```

Set `DICT_BENCH_DATA=/some/dir` to read datasets from elsewhere.

## Datasets

| File | Source | License | Used by |
|---|---|---|---|
| `words_alpha.txt` | [dwyl/english-words](https://github.com/dwyl/english-words) — 370,105 words | Unlicense | `fmbench`, `fm_sizemodel`, `trigram` |
| `webster.json` | [Webster's 1913](https://github.com/matthewreagan/WebstersEnglishDictionary) — 102,217 entries with definitions | Public domain | `sizemodel_full`, `glossopt`, `tiers` |

Webster's 1913 is a **size proxy** for definition-heavy data. The shipping
dictionary is English Wiktionary via Kaikki (CC-BY-SA); these benchmarks will be
re-run on it once the ingest pipeline lands.

## Scripts

| Script | Question it answers |
|---|---|
| `fmbench.py` | Does an FM-index give correct substring search, and how fast? (builds BWT, verifies counts vs brute force, measures latency) |
| `fm_sizemodel.py` | How big is the FM-index — naive vs engineered (wavelet tree / RRR) rank, sampled-SA vs separator-rank locate? |
| `trigram.py` | Baseline: how big and fast is SQLite FTS5 trigram on the same words? |
| `sizemodel_full.py` | What is the *total* app size with definitions, and what share is the search index? |
| `glossopt.py` | How small can definitions get with block compression + a trained zstd dictionary? |
| `tiers.py` | Zipf tiering: core size vs lookup coverage for top-N words by frequency |

## Recorded results

Measured 2026-10-26, Python 3.11, Linux x86-64. FM-index numbers come from a
pure-Python prototype; SQLite FTS5 is native C.

**Search index — 370,105 words (raw text 3.7 MB)**

| Approach | Size | Substring query latency |
|---|---|---|
| FM-index, naive (measured) | 8.7 MB | 0.015 ms |
| FM-index, engineered (modeled) | ~2.5 MB | — |
| SQLite FTS5 trigram | 20.0 MB | 0.17 ms |
| SQLite plain table, `LIKE '%q%'` scan | 12.7 MB | ~26–36 ms |

- Correctness: 40/40 random 3-gram counts match brute force; `eren` → 495/495
  hits genuinely contain it.
- Measured naive FM-index is **~2.3× smaller** than FTS5 trigram and faster per
  query. The engineered figure (~8× smaller) is a **model** from standard
  succinct-structure ratios and still needs confirming with a real succinct
  library.

**Whole app — 102,217 Webster entries**

- Definition text is **~21×** the headword text; the search index is only
  **~7–9%** of total app size. Definitions are the size problem.
- Definitions compress ~3× with block-1024 zstd + a trained dictionary
  (20.0 MB → 7.1 MB, random-access).

**Gloss tiers (ranked by `wordfreq`)**

| Full definitions for | Gloss size | Text coverage |
|---|---|---|
| top 20,000 | 3.8 MB | 99.6% |
| **top 50,000** (chosen, ADR-0001) | **5.7 MB** | ~100% |
| all 102,217 | 7.3 MB | 100% |

Coverage is *reading* frequency; dictionary lookups skew rarer, which is why
the core boundary is 50k rather than 20k. See
[`docs/adr/0001-frequency-tiered-gloss-storage.md`](../docs/adr/0001-frequency-tiered-gloss-storage.md).
