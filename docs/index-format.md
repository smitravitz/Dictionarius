# Headword index format (v1)

The binary file the app loads to search every headword. Written by
[`scripts/build_fm_index.py`](../scripts/build_fm_index.py), read by the app's
TypeScript loader. This document is the contract between the two.

All integers are **little-endian**. Every section starts on an **8-byte
boundary**, so the loader can view each one as a typed array over the file's
`ArrayBuffer` without copying.

## Normalization

Search keys are normalized with rule `nfd-strip-diacritic-lower-trim/v1`,
identical to `src/normalize.ts`:

1. Unicode NFD
2. remove every `\p{Diacritic}` character
3. lowercase (full Unicode mapping, including final sigma)
4. trim JavaScript whitespace (as `String.prototype.trim`)

The loader must reject a file whose `normId` differs from its own rule. The
golden file carries normalization samples that both sides must agree on.

## Indexed text

Take the unique normalized headwords, UTF-8 encode them, and sort them
**bytewise ascending**. Word ID = position in that order (`0 … k−1`). The
indexed text is

```
T = SEP w0 SEP w1 SEP … SEP w(k−1) SEP TERM        SEP = 0x01, TERM = 0x00
```

and the FM-index is built over the **bytes** of `T` (`n = |T|`). UTF-8 byte
order equals code-point order, so a query is simply the UTF-8 bytes of the
normalized query string. Normalized headwords never contain bytes below 0x20.

## Header (96 bytes, offset 0)

| Offset | Type | Field | Meaning |
|---|---|---|---|
| 0 | 8 bytes | `magic` | ASCII `DICTFMv1` |
| 8 | u32 | `version` | `1` |
| 12 | u32 | `flags` | bit 0 = `FREQ`, bit 1 = `HOTK`, bit 2 = `SHAPE`, bit 3 = `EXPLICIT` present |
| 16 | u32 | `n` | length of `T` in bytes |
| 20 | u32 | `numWords` | `k` |
| 24 | u32 | `blockShift` | `8` (rank block = 256 positions) |
| 28 | u32 | `superShift` | `16` (rank superblock = 65,536 positions) |
| 32 | u32 | `numDense` | `D`, symbols with block rank tables |
| 36 | u32 | `numSparse` | `S`, symbols with position lists |
| 40 | u32 | `numSections` | entries in the section table |
| 44 | 48 bytes | `normId` | ASCII, NUL-padded |
| 92 | u32 | `numHot` | words in the hot list (0 when `HOTK` is absent) |

Files written before the hot list existed have zero at offset 92 and flag bit 1
clear, so they still load; search just skips the fast path. Files written
before shapes existed have flag bit 2 clear; every word then counts as shape 0.
Without flag bit 3 no word is marked explicit (also the case for builds from a
plain word list, which has no labels to go on).

## Section table (offset 96)

`numSections` entries of 16 bytes each: `name` (8 bytes ASCII, NUL-padded),
`offset` (u32, from start of file), `byteLength` (u32).

## Sections

| Name | Type | Length | Contents |
|---|---|---|---|
| `C` | u32 | 257 | `C[c]` = number of BWT bytes smaller than `c`; `C[256] = n` |
| `BWT` | u8 | `n` | Burrows–Wheeler transform of `T` |
| `DSYM` | u8 | `D` | the dense symbols |
| `SUPER` | u32 | `(n >> 16) + 1` × `D` | row-major: `SUPER[s·D + d] = occ(DSYM[d], s << 16)` |
| `BLOCK` | u16 | `(n >> 8) + 1` × `D` | row-major: `occ(DSYM[d], b << 8)` minus `SUPER` of its superblock (`b >> 8`) |
| `SSYM` | u8 | `S` | the sparse symbols |
| `SOFF` | u32 | `S + 1` | offsets into `SPOS` per sparse symbol |
| `SPOS` | u32 | total | ascending BWT positions of each sparse symbol |
| `FREQ` | u16 | `k` | rank score × 100 (0 = unknown); only if flag bit 0. See *Ranking* |
| `VIDS` | u32 | `V` | ascending word IDs that have display forms |
| `VOFF` | u32 | `V + 1` | offsets into `VBLOB` |
| `VBLOB` | u8 | total | per word: its display forms, UTF-8, separated by 0x00 |
| `HOTK` | u8 | total | keys of the first `numHot` words in rank order, each followed by `SEP`; only if flag bit 1 |
| `SHAPE` | u8 | `k` | per word: 0 = one word, 1 = hyphenated, 2 = has spaces; only if flag bit 2. See *Ranking* |
| `EXPLICIT` | u32 | total | ascending IDs of explicit words; only if flag bit 3. See *Safe search* |

A byte value that never occurs in the BWT is in neither `DSYM` nor `SSYM`.
Dense vs sparse is chosen per symbol to minimize size: a symbol is dense when
it occurs more than `n / 512` times.

## Operations

`occ(c, i)` = occurrences of byte `c` in `BWT[0 … i)`, for `0 ≤ i ≤ n`:

```
dense c (index d):  b = i >> 8
                    SUPER[(i >> 16)·D + d] + BLOCK[b·D + d]
                      + count of c in BWT[(b << 8) … i)
sparse c:           number of SPOS entries for c that are < i   (binary search)
absent c:           0
```

```
LF(r)        = C[BWT[r]] + occ(BWT[r], r)

range(p)     backward search over the bytes of p, last to first:
               l = 0, r = n
               for c in reversed(p):  l = C[c] + occ(c, l);  r = C[c] + occ(c, r)
               stop if l ≥ r  (no match)
             r − l = number of occurrences of p in T

prefix(q)    rows = range(SEP + q)            q non-empty
             word IDs = [rows.l − C[SEP] − 1 … rows.r − C[SEP] − 1)   contiguous

exact(q)     rows = range(SEP + q + SEP);  match iff r − l = 1
             word ID = rows.l − C[SEP] − 1

locate(row)  word containing an occurrence row (from range of a mid-word query):
               while BWT[row] ≠ SEP:  row = LF(row)
               word ID = occ(SEP, row) − 1

extract(id)  normalized bytes of a word:
               row = C[SEP] + (id = k−1 ? 0 : id + 2)
               collect BWT[row], row = LF(row)  until BWT[row] = SEP
               the bytes come out in reverse order
```

Why these work: the rows that start with `SEP` are sorted by the word that
follows, and the shortest such suffix, `SEP TERM`, sorts first. So row
`C[SEP] + 1 + i` is the separator in front of word `i`, and row `C[SEP] + 0` is
the separator after the last word.

## Ranking

`FREQ` holds a **rank score**: the word's [wordfreq](https://github.com/rspeer/wordfreq)
Zipf frequency (the highest among its display forms), minus **1.0 per extra
part** as wordfreq splits it (spaces and hyphens), and 1.0 more for an affix
(`-something`, `anti-`). wordfreq scores a phrase or compound at roughly its
rarest part's frequency (`of a` = 7.08 like `of`; `going-to` = 5.93 like
`going`), so without the penalty they crowd out real words. A known word never drops below 0.01, so it still
outranks words with no frequency data (0).

**Shape** comes before the score. A key containing whitespace (any character
JavaScript's `\s` matches) is shape 2: phrases and names such as `ice cream`.
Otherwise a key containing a hyphen or dash (U+002D, U+2010–U+2014) is shape 1:
compounds and affixes such as `well-being` or `-ing`. Everything else is shape
0, a single word. Single words list first, so a phrase never outranks a word.

**Rank order** = shape ascending, then score descending, then word ID ascending
(alphabetical). The app can rebuild it in one pass with a counting sort over a
combined key, such as `(2 − shape) × 2000 + FREQ`.

## Safe search

`EXPLICIT` lists the words safe search hides. Wiktionary labels each meaning of
a word; a meaning is explicit when its tags include `vulgar`, `offensive` or
`slur`, or its categories include *English vulgarities*, *English offensive
terms*, *English ethnic slurs* or *English swear words*. A headword is explicit
when its **main meaning** is: the first meaning of its first entry, as the page
lists it. So is a word whose main meaning is just a plural, tense or spelling
(`form_of`, `alt_of`) of such a word, or of one of those, however many steps
(`sand-niggers` is the plural of a spelling of `sand nigger`). Only main
meanings that are nothing but a form are followed, so an ordinary word is
never reached: `is` is a form of `be`, whose main meaning is "to exist".

Labels further down a word's meanings hide nothing. Plenty of everyday words
carry a rare slur or vulgar sense that almost nobody means, and a word with an
innocent first meaning can still be mostly known as a bad word; telling those
apart takes a person, not a rule. `derogatory`, `pejorative` and `slang` alone
don't count.

A search key is explicit when its most common written form is (by wordfreq, as
in *Display forms*; ties go to the lowercase form, then to a form that isn't
explicit, so a slur spelling such as `RuSSian` can't hide `Russian`).

**Hand-picked list.** [`data/safe-search.list`](../data/safe-search.list)
names search keys to **block** (bad words whose first meaning is innocent, and
ones the labels miss), to **allow** (names and ordinary words that share a
key with an offensive word, and the odd ordinary word a chain of spellings
reaches, such as `foo`), and pieces whose words all **contain** a slur, which
hide every key containing them (`snigger` reads as the slur in it; so do
compounds such as `glownigger` that Wiktionary doesn't label). Allow wins. It is stored encoded so the repository doesn't
carry a readable list of slurs; `python scripts/safe_search_list.py show`
decodes it, and `add` / `remove` edit it. Part of the block list was picked by hand from
[cuss](https://github.com/wooorm/cuss)'s likely-profane words (MIT; see `data/README.md`);
`scripts/safe-search-candidates.ts` lists the words of any such list that safe search still shows. A blocked key is just that key (list
its plural too); an allowed word's plurals and tenses stay visible with it.
The builder applies the list, and the app applies it again when it loads, so
an edit reaches the app without rebuilding the index.

Each build writes `<out>.safe-review.tsv`: every hidden word, and every
visible word labelled a slur or plainly offensive further down, most common
first, with why. That is where candidates for the list come from. It also
writes `<out>.labels.jsonl.gz`, the labels this rule reads, so a rule change
can be rebuilt (`--labels`) without the multi-GB dump.

A hidden word stays hidden even when it is typed out in full.

## Hot list

`HOTK` holds the keys of the first `numHot` words in rank order (default
200,000), each terminated by `SEP`. Entry `i` is the word at rank position `i`,
so its ID is the `i`-th ID in rank order and isn't stored. A plain string
search over this text yields mid-word matches already ranked, which makes the
first results for a fragment like `tion` instant. Words beyond the hot list are
still found through the FM-index.

## Display forms

A word has a `VIDS` entry only when its display forms differ from its
normalized key (capitals, diacritics, variants such as `résumé` / `Resume`).
Forms are listed most frequent first by wordfreq (so `Hawaii` comes before
`Hawaiʻi` and `Hawai`i`); ties put the plain key first, then forms that aren't
explicit (wordfreq ignores case: `Russian` before the slur spelling `RuSSian`),
then code-point order.
The first form is the one to show. With no entry, the display form is the
normalized key.

## Versioning

Any layout change bumps `magic`/`version`. The loader rejects unknown versions,
an unknown `normId`, and files whose section table runs past the end of the
buffer.
