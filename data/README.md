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

## Safe search's hand-picked list

`safe-search.list` (encoded; `python scripts/safe_search_list.py show` decodes it) names search
keys safe search always hides or always shows. Most entries are the project's own choices. Part of
the block list was chosen from **[cuss](https://github.com/wooorm/cuss)** by Titus Wormer: a
person reviewed the English words cuss rates as likely profane and kept only the bad words the
Wiktionary labels missed (everyday words and names in it were left out).
`scripts/safe-search-candidates.ts` repeats that comparison against a newer cuss.

cuss is used under the MIT License:

> Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com>
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the 'Software'), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
> BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
