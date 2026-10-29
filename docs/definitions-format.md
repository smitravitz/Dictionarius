# Definitions file format (`*.definitions.bin`, version 2)

Every word's definitions, by the headword index's word id
([index format](index-format.md)), written by `scripts/build_fm_index.py`
(`scripts/definitions.py`) from the Wiktionary dump and read by
`src/definitions.ts`. Why it is packed this way: [ADR-0004](adr/0004-all-definitions-bundled.md).

All integers are little-endian.

## Layout

| Offset | Size | Field |
|---|---|---|
| 0 | 8 | magic `DICTDEF1` |
| 8 | u32 | version `2` |
| 12 | u32 | codec `2` = brotli |
| 16 | u32 | `numWords`: the index's word count |
| 20 | u32 | `perBlock`: word ids per block (4,096) |
| 24 | u32 | `numBlocks` = ⌈numWords / perBlock⌉ |
| 28 | u32 | `tablesLength` |
| 32 | 32 | `keysHash`: SHA-256 of the index's keys in id order, joined by `0x01`; equals the index's `KEYHASH` section |
| 64 | `tablesLength` | tables, JSON (UTF-8, space-padded to a multiple of 4) |
| … | u32 × (numBlocks + 1) | block offsets from the start of the file; block *b* is bytes `[offset[b], offset[b+1])` |
| … | | blocks |

A reader refuses a file whose `keysHash` or `numWords` differs from its
index: the ids would point at other words.

**Tables:** `{"pos": [...], "templates": [...]}`. `pos` lists the word classes
(Wiktionary's part-of-speech codes, most common first). `templates` lists link
glosses with their one linked word replaced by U+0000 (`"plural of \u0000"`),
used at least twice, most common first, at most 4,096.

**Block:** brotli-compressed UTF-8: one line per word id in the block,
separated by `\n`; an empty line for a word without definitions.

## A word's line

JSON: `[forms, entries, etymologies, pronunciations]`, trailing empty lists
left out.

- `forms`: the written forms its entries are under; `0` stands for the search
  key itself (the reader gets it from the index).
- `entries`, one per Wiktionary entry, most common written form first, then in
  Wiktionary's order: `[form, pos, meanings, etymology, pronunciation]`.
  `form` indexes `forms`; `pos` indexes `tables.pos` (or is the code itself, or
  null); `etymology` and `pronunciation` are 1-based into the word's lists (0
  or left out: none).
- A meaning: `[gloss, labels, of, explicit, links, example]`, trailing empty
  values left out. `gloss` is the text, or a number: `tables.templates[n]` with
  U+0000 replaced by `of[0]` (literally). `labels` are tags and qualifiers to
  show ("archaic", "of jelly"); `of` the words a plural or spelling links to;
  `explicit` is 1 for a vulgar, offensive or slur meaning (the labels safe
  search reads), which safe search hides. `links` are Wiktionary's links
  inside the gloss: a string when the text is also the word linked to, else
  `[text, word]`. `example` is one short use of the meaning (Wiktionary's
  first usage example up to 200 characters, else its first quotation that
  short), or `""`.
- `links` and `example` came later, at the end of the row, so a reader that
  doesn't know them still reads the rest; the version stayed 2.
- `etymologies`: strings; `pronunciations`: lists of IPA strings.

Unpacked, a word is a list of `{form, pos, meanings: [{gloss, labels?, of?,
explicit?, links?, example?}], etymology?, ipa?}`; `scripts/definitions.py` and
`src/definitions.ts` both unpack it, and the builder's golden file checks they
agree.
