# Definitions file format (`*.definitions.bin` and its layers, version 3)

Every word's definitions, by the headword index's word id
([index format](index-format.md)), written by `scripts/build_fm_index.py`
(`scripts/definitions.py`) from the Wiktionary dump and read by
`src/definitions.ts`. Why it is packed this way: [ADR-0004](adr/0004-all-definitions-bundled.md);
why it is split: [ADR-0005](adr/0005-layered-data-packs.md).

The definitions are four files of one layout, side by side:

| File | Kind | Holds |
|---|---|---|
| `headwords.definitions.bin` | `core` | written forms, word classes, meanings (gloss, labels, linked words, links, safe-search flag) |
| `headwords.examples.bin` | `examples` | one short example per meaning |
| `headwords.etymology.bin` | `etymology` | where each word comes from |
| `headwords.pronunciation.bin` | `pronunciation` | pronunciations (IPA) |

Only the core is needed: an app without a layer shows everything else. Each file
is tied to the index (`keysHash`) and to the core (same `numWords`, `perBlock`).
`scripts/upgrade_definitions.py` turns a version-2 file (everything in one) into
these four, without the dump.

All integers are little-endian.

## Layout (each file)

| Offset | Size | Field |
|---|---|---|
| 0 | 8 | magic `DICTDEF1` |
| 8 | u32 | version `3` |
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
index (the ids would point at other words), and a file whose `kind` isn't
the one it was opened as.

**Tables:** `{"kind": …}`, plus, in the core, `"pos"` and `"templates"`. `pos`
lists the word classes (Wiktionary's part-of-speech codes, most common first).
`templates` lists link glosses with their one linked word replaced by U+0000
(`"plural of \u0000"`), used at least twice, most common first, at most 4,096.

**Block:** brotli-compressed UTF-8: one line per word id in the block,
separated by `\n`; an empty line for a word with nothing in this file.

## A word's lines

JSON, trailing empty values left out.

**Core:** `[forms, entries]`.

- `forms`: the written forms its entries are under; `0` stands for the search
  key itself (the reader gets it from the index).
- `entries`, one per Wiktionary entry, most common written form first, then in
  Wiktionary's order: `[form, pos, meanings, etymology, pronunciation]`.
  `form` indexes `forms`; `pos` indexes `tables.pos` (or is the code itself, or
  null); `etymology` and `pronunciation` are 1-based into the word's lines in
  those layers (0 or left out: none).
- A meaning: `[gloss, labels, of, explicit, links]`. `gloss` is the text, or a
  number: `tables.templates[n]` with U+0000 replaced by `of[0]` (literally).
  `labels` are tags and qualifiers to show ("archaic", "of jelly"); `of` the
  words a plural or spelling links to; `explicit` is 1 for a vulgar, offensive
  or slur meaning (the labels safe search reads), which safe search hides.
  `links` are Wiktionary's links inside the gloss: a string when the text is
  also the word linked to, else `[text, word]`.

**Examples:** one string per meaning, in reading order across the word's
entries: Wiktionary's first usage example up to 200 characters, else its first
quotation that short, or `""`.

**Etymology:** a list of strings. **Pronunciation:** a list of lists of IPA strings.

Unpacked, a word is a list of `{form, pos, meanings: [{gloss, labels?, of?,
explicit?, links?, example?}], etymology?, ipa?}`; `scripts/definitions.py` and
`src/definitions.ts` both unpack it, and the builder's golden file checks they
agree.
