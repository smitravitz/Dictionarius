# Dictionary data — license & attribution

Dictionary content in this folder (and in any data bundle or download Dictionarius
ships) is **not** covered by the GPL that applies to the code. It keeps the
license of its source.

## Source

Definitions, parts of speech, and pronunciations come from
**[English Wiktionary](https://en.wiktionary.org)**, written by Wiktionary
contributors, extracted to structured form via
[wiktextract](https://github.com/tatuylonen/wiktextract) /
[kaikki.org](https://kaikki.org).

> Tatu Ylonen. *Wiktextract: Wiktionary as Machine-Readable Structured Data.*
> Proceedings of LREC 2022, pp. 1317–1325.

## License

Wiktionary text is available under the
[Creative Commons Attribution-ShareAlike](https://creativecommons.org/licenses/by-sa/4.0/)
license (and the GFDL). Dictionarius redistributes it, and every data file
derived from it, under **[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)**.

You may reuse this data, including commercially, provided you give attribution
and share your adaptations under the same license.

## How Dictionarius meets the license terms

- **Attribution.** Every displayed entry credits its source and license, and
  links to the entry's page on Wiktionary
  (`https://en.wiktionary.org/wiki/<headword>`), where its full author history
  is available.
- **License notice.** This file, and the in-app About / data screen, state the
  CC BY-SA 4.0 license with a link to its text.
- **Modifications indicated.** Compared with the original Wiktionary pages, this
  data has been:
  - extracted from wiki markup into structured fields;
  - reduced to selected fields (headword, part of speech, definitions,
    pronunciation) — etymology, examples, translations and quotations are
    omitted or shipped as separate optional packs;
  - normalized (Unicode folding for search keys);
  - ranked by word frequency and split into a bundled core (top 50,000 words)
    and an on-demand tail;
  - compressed and indexed (FM-index for headwords, zstd for definitions).
- **Share-alike.** Data derived from Wiktionary is published under CC BY-SA 4.0.

## Separate works

The application code (GPL-3.0-or-later, see [`LICENSE`](../LICENSE)) and this
data (CC BY-SA 4.0) are separate works distributed together. Each keeps its own
license.

## Not shipped

Datasets used only by the benchmarks in [`bench/`](../bench/) (a public-domain
Webster's 1913 dictionary and an Unlicense word list) are downloaded on demand,
never committed, and never shipped in the app.
