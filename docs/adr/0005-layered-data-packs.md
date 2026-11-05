# ADR-0005: Word ids as the spine; data in layers; a language is a pack

- **Status:** Proposed; step 1 (the split) accepted and built, 2026-11-05. Each other step
  lands only after its measurement gate, below.
- **Date:** 2026-11-03
- **Deciders:** project owner
- **Builds on:** [ADR-0003](0003-filters-from-word-columns.md) (word columns),
  [ADR-0004](0004-all-definitions-bundled.md) (definitions file). Amends ADR-0004's single
  definitions file; reopens the delivery question [ADR-0002](0002-offline-only-data-packs.md)
  left behind.
- **Related:** `src/headword-index.ts`, `src/definitions.ts`, `scripts/build_fm_index.py`,
  `scripts/definitions.py`, `docs/index-format.md`, `docs/definitions-format.md`

## Context and problem statement

The app has grown one feature at a time: filters, definitions, links, pronunciation, etymology,
examples. Each went wherever was handy (a column in the index, a field in the definitions file,
a word spelled out as text), and the APK grew to 73.3 MB to download (102 MB reported
installed). Next on the roadmap are translations, starting with French, then other languages:
added the same way, every language would multiply the definitions and repeat words as text.

What the v0.5.0 APK holds (measured, `unzip -lv`):

| File | In the APK | Share |
|---|---|---|
| `headwords.definitions.bin` (brotli; doesn't compress further) | 56.8 MB | 77% |
| `headwords.bin`, the FM-index (32.8 MB raw) | 12.9 MB | 18% |
| code, fonts, the rest | ~3.6 MB | 5% |

So the FM-index claim holds (mid-word search over 1,357,380 keys in 12.9 MB), but the app's
size is its definitions. Their text, measured on the 5% sample (`definition_of`, before
packing): meanings 55%, examples 22%, etymology 22%, pronunciation 1%. Meanings after a word
class's third are 8% of the meanings' text; obsolete, archaic, dated, rare and historical
meanings 6%; "plural of X"-style meanings 26% (already packed as templates). Trimming
meanings saves little; examples and etymology are the weight.

The index, by section (raw → deflate, measured on the 2026-10-28 full build): BWT 16.2 →
6.1 MB, rank blocks `BLOCK` 3.4 → 2.0, display forms `VIDS`/`VOFF`/`VBLOB` 5.4 → 2.7, `FREQ`
2.7 → 0.9, hot list `HOTK` 1.7 → 0.8, `SPOS` 0.4 → 0.3, `SHAPE` 1.4 → 0.1.

The worker also reads the whole definitions file into memory (`loadDefinitions` reads the
response as one ArrayBuffer): 57 MB of a phone's memory for a page that shows one word.

## Decision drivers

- Size first: download, storage and memory, in that order.
- A new feature or language is a new file of a known kind, not a new field threaded through
  the builder, the formats, the worker and the page (ADR-0003's rule, made general).
- Nothing spelled out twice: a word mentioned anywhere (a link, "plural of", a synonym, a
  translation) is stored as its id, once.
- Optional content is truly optional: the app works, smaller, without it.
- Offline and private: no network permission; F-Droid, IzzyOnDroid and Obtainium friendly.
- Every claim about size or speed is measured before it's built on.

## Considered options

1. **Keep one definitions file, add fields per feature** (today's path). Simplest; every
   feature grows the one file everyone downloads, translations included. Rejected.
2. **A database (SQLite) for everything but search.** Familiar and flexible, but row overhead
   and per-row compression lose to blocked brotli (FTS5 trigram measured 2.3× larger than the
   FM-index for search alone), and it brings WebAssembly the app's CSP rules out. Rejected.
3. **One combined index for every language**, language as a word column. Mid-word search
   across languages for free; but adding a language changes every word's id, so every layer of
   every language must be rebuilt and shipped together: no independent packs. Rejected.
4. **Word ids as the spine; data in typed layer files; one index per language** (chosen).

## Decision

### 1. A word id is the spine

A word id is a key's rank in its language's FM-index (layer 0). Everything else about a word
is stored by id, in one of three layer kinds below. Ids change with every rebuild, so every
layer file carries its index's key-list hash (`KEYHASH`, as the definitions file already does)
and a reader refuses a mismatch. A layer is always built in the same run as its index.

### 2. Four layers, three file kinds

| Layer | Kind | Holds | Read |
|---|---|---|---|
| 0. Key index | FM-index (today's `headwords.bin`) | text → id; mid-word search | at start |
| 1. Word columns | fixed width per id, in the index (ADR-0003) | length, name, shape, frequency, safe search, … | at search time |
| 2. Content | records per id, blocked, brotli | meanings; examples; etymology; pronunciation | per word shown |
| 3. Relations | sorted id pairs, delta-coded, blocked | links, "plural of", synonyms, translations | per word shown |

- **Columns** stay in the index: filters and ranking need them for every word at search time.
- **Content** is the definitions file, split by what it holds: `core` (word classes, meanings,
  labels, safe-search flag), `examples`, `etymology`, `pronunciation`, each its own file in the
  same container. The page shows whatever files are present.
- **Relations** replace words written out as text. A link inside a meaning becomes its span in
  the gloss plus the target's id; "plural of X" becomes the template plus X's id; synonyms and
  translations are lists of ids. An id costs 2–3 bytes after delta coding, against the word's
  spelling (often twice) today.

### 3. One container for content and relations

One file layout, one reader (`DefinitionsFile` generalised): a header (magic, version, kind,
language, the index's `KEYHASH`, codec, block size), a JSON table of what the records share
(templates, word classes, labels), a block offset table, then blocks compressed separately.
`docs/definitions-format.md` becomes `docs/layer-format.md`; today's definitions file is its
first instance. The reader takes a block at a time, so a layer is never all in memory.

### 4. A language is a pack

A language ships as its own index plus its layers, with ids of its own:
`fr.index.bin`, `fr.core.bin`, `fr.examples.bin`, … Glosses come from English Wiktionary's
entries for that language (in English, which is what an English reader wants). Translations
are a relations file between two packs, `en-fr.translations.bin`, keyed by English word id and
meaning number, holding French word ids; it carries both packs' `KEYHASH`es.

Searching several languages queries each enabled index (microseconds each) and merges the
results by the same order (position, then rank); counts and the slider's per-position counts
add up. Adding a language changes no other pack.

### 5. Slimmer index

- Rank tables (`BLOCK`) and the hot list (`HOTK`) are rebuilt when the app opens instead of
  shipped, if the measured cost allows (gate below).
- `FREQ` becomes one byte per word (Zipf × 30 fits in a byte).
- Display forms (`VIDS`/`VOFF`/`VBLOB`) packed tighter (delta-coded ids, varint offsets).

### 6. Delivery

The core English pack is in every APK. Examples, etymology and other languages are packs:
bundled per APK flavour first (no new permissions, nothing for F-Droid to flag), with a
user-imported pack file (ADR-0002's idea) as a later option. Which flavours to publish is an
open question.

## Measurement gates

Each step lands only when its numbers are measured on a full build (bench scripts beside
`bench/definitions_packing.py`), and recorded here:

| Step | Gate | Measured |
|---|---|---|
| Split content into core / examples / etymology / pronunciation | sizes per file; core ≤ 35 MB | ✅ core 33.8 MB; examples 13.3, etymology 8.5, pronunciation 1.1; 56.9 MB in all, as one file was. Word page median 61 ms (was 58). Built: version 3 of the format |
| Links and "plural of" as ids | core shrinks; unpack time per block no worse than +20% | |
| Gloss words as ids (tried, kept only if it wins) | ≥ 10% smaller core after brotli | |
| Blocks read one at a time | peak memory ≤ index + 2 blocks (the whole app's, not only the worker's) | ❌ not yet: see *Evidence* |
| Rank tables and hot list rebuilt at open | ≤ 150 ms with the CPU slowed 4× |
| One-byte frequency, packed display forms | index smaller; results unchanged on the golden queries, or each change in order reviewed |
| Merged search over two indexes | first page ≤ 2× one index's time |

## Evidence

Measured 2026-11-05 on the released data (v0.5.1's `data-…`: 1,357,380 words), Chromium,
phone viewport; memory is resident memory summed over Chromium's processes after opening
three words; word page time is Enter to its meanings shown, median of eight words.

- **Split** (`bench/layer_split.py` on the real file; then `scripts/upgrade_definitions.py`,
  which writes through the builder's own writer and matches a fresh build byte for byte
  on the fixture): sizes in the table above. Old and new readers agree on 3,000 random
  words. Splitting costs nothing in size: each kind compresses as well on its own.
- **Blob slices don't save memory.** Keeping each file as a `Blob` and reading a block
  with `blob.slice()` took 57 MB out of the worker's process but put 55 MB into the
  browser's (where Chromium keeps Blobs): 579 → 576 MB in all. Word pages went from
  58 to 135 ms. Not adopted; the reader keeps the seam (`ByteSource`) a real ranged
  source plugs into.
- **Range requests can't do it in the Android app yet.** Capacitor's local server
  (`WebViewLocalServer.handleLocalRequest`) answers a Range request with 206 and the
  asked-for `Content-Range`, but sends the file from its first byte. A ranged source
  needs that fixed (upstream, or our own path handler) or a small native reader of
  asset ranges (with the definitions files stored uncompressed in the APK). The web
  (GitHub Pages) serves ranges.
- **The decoder's window.** The JavaScript brotli decoder sets aside the window a block
  declares for every block it unpacks (10 unpacks of a 110 KB block: 10.7 MB at the old
  4 MB window, 3.3 MB at one sized to the block). Blocks declared 4 MB (`lgwin=22`)
  whatever their size; each now declares a window just over its own size. Sizes unchanged.
- **Open: about 30 MB more resident in Chromium.** With the split, Chromium's worker process
  holds about 30 MB more than with one file (after forced garbage collection: 570 → 603
  and 564 → 598 MB in all), not explained by the decoder's window, by downloading the
  files at once, or by the data held: in Node, the new reader holds less live memory
  than the old (27.9 against 34.5 MB after six words). To measure on a phone
  (`adb shell dumpsys meminfo`) before calling the step done on memory.

## Consequences

- Projected core download about 30–35 MB (from 73.3), examples and etymology about 13 and
  9 MB as packs (estimates scaled from the sample; the gates replace them with measurements).
- A new feature has a home: a column if search needs it, a content file if a word's page shows
  it, a relations file if it links words. Synonyms, translations, rhymes, anagram groups and
  word families all fit the relations kind with no new format.
- Packs are tied to one build of their index; a pack from another build is refused, never
  misread. Releases publish matching sets (`data/headwords.sha256` lists every file).
- More files to build and check: the builder writes them all in one run, and the golden test
  covers each layer the way it covers definitions today.
- Cross-language search is a merge of separate lists rather than one list, which costs a little
  code in the completer and keeps every language independent.
- ADR-0004's single definitions file is superseded once the split lands; its packing (compact
  JSON lines, templates, brotli per block) carries over unchanged.

## Open questions

- Which APK flavours to publish (English core only; core plus examples; per language), and
  whether IzzyOnDroid's 30 MB guideline makes "core only" the default there.
- The 102 MB installed figure against the 73.3 MB APK: Android's storage breakdown (app, data,
  cache) will say what the rest is.
- Where translations come from in bulk (English Wiktionary's translation tables, per sense) and
  how many pairs French brings; the relations file's size follows from that count.
- Whether a user-imported pack (no network) is worth its import screen before a second language
  exists.
