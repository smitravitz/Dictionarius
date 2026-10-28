# Test fixtures

## `headwords-sample.*`

A small headword index used by `test/headword-index.test.ts`, so the loader is
tested in CI without the full 27 MB build.

| File | What |
|---|---|
| `headwords-sample.words.json` | source: 17,090 headwords |
| `headwords-sample.bin` | index built from it (format v1, `docs/index-format.md`) |
| `headwords-sample.golden.json` | brute-force answers the tests compare against |
| `headwords-sample.safe-review.tsv` | the words safe search hides, with why |
| `headwords-sample.labels.jsonl.gz` | the labels safe search read (rebuild with `--labels`) |

**Source & license.** Every 6th word of Webster's 1913 dictionary (public
domain), with ~10% capitalized or upper-cased, plus hand-picked edge cases:
diacritic variants that collide on one key (`Résumé` / `résumé` / `Resume`),
Greek final sigma, `Hawaiʻi`, `İstanbul`, Cyrillic, CJK, emoji, a BOM, a
non-breaking space, words that repeat a fragment (`banana`, `cancan`), and eight made-up words
with Wiktionary-style labels for safe search: `rudeword` (vulgar), its plural and spelling, and
`slurword` are hidden; `gapword` (an everyday meaning, then a slur) and its plural, `mixedword` (an
everyday meaning, then a vulgar one) and `hedgeword` (an everyday meaning, then a dated, offensive
one) stay visible. Five made-up entries with a part of speech: `Zorbleton` and `Quillmarch` are names;
`turkeyword` (a bird) and `Turkeyword` (a country) share a key that stays a common word; `zorble` is a
verb. No Wiktionary content. Built without the hand-picked list (`--safe-search-list ''`),
so the tests don't depend on it.

**Rebuild** (after a format or normalization change):

```bash
python scripts/build_fm_index.py test/fixtures/headwords-sample.words.json \
  --out test/fixtures/headwords-sample --hot 3000 --safe-search-list ''
```

The build verifies itself against brute force before writing the golden file.

**Full-scale check.** The same test suite runs against a real build when one is
present at `dist/headwords.bin` (or `$DICTIONARIUS_INDEX`, path without
extension):

```bash
DICTIONARIUS_INDEX=dist/headwords npx vitest run test/headword-index.test.ts
```
