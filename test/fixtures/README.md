# Test fixtures

## `headwords-sample.*`

A small headword index used by `test/headword-index.test.ts`, so the loader is
tested in CI without the full 27 MB build.

| File | What |
|---|---|
| `headwords-sample.words.json` | source: 17,087 headwords |
| `headwords-sample.bin` | index built from it (format v1, `docs/index-format.md`) |
| `headwords-sample.golden.json` | brute-force answers the tests compare against |

**Source & license.** Every 6th word of Webster's 1913 dictionary (public
domain), with ~10% capitalized or upper-cased, plus hand-picked edge cases:
diacritic variants that collide on one key (`Résumé` / `résumé` / `Resume`),
Greek final sigma, `Hawaiʻi`, `İstanbul`, Cyrillic, CJK, emoji, a BOM, a
non-breaking space, words that repeat a fragment (`banana`, `cancan`), and five made-up words
with Wiktionary-style labels for safe search (`rudeword`, its plural and spelling, `slurword`,
`mixedword`). No Wiktionary content.

**Rebuild** (after a format or normalization change):

```bash
python scripts/build_fm_index.py test/fixtures/headwords-sample.words.json \
  --out test/fixtures/headwords-sample --hot 3000
```

The build verifies itself against brute force before writing the golden file.

**Full-scale check.** The same test suite runs against a real build when one is
present at `dist/headwords.bin` (or `$DICTIONARIUS_INDEX`, path without
extension):

```bash
DICTIONARIUS_INDEX=dist/headwords npx vitest run test/headword-index.test.ts
```
