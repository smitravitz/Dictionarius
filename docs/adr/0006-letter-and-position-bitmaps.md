# ADR-0006: FM-index stays the engine; letters and positions as bitmaps beside it

- **Status:** Proposed (each step lands only after its measurement gate, below)
- **Date:** 2026-11-05
- **Deciders:** project owner
- **Builds on:** [ADR-0003](0003-filters-from-word-columns.md) (word columns, one compiled
  filter), [ADR-0005](0005-layered-data-packs.md) (word ids as the spine, layers, language
  packs). Adds a column to layer 1 and a fourth layer kind.
- **Related:** `src/filters.ts` (`WordFilter`), `src/complete.ts`, `src/headword-index.ts`,
  `docs/index-format.md`, `bench/`

## Context and problem statement

People asked for searches the FM-index can't answer by itself: words that contain `eat`
and also an `m` or an `n`; words with no `e`; Wordle-style patterns such as `_a_e_`
(a letter at a given place). In general: any boolean combination of letter and position
conditions, with an exact count, and the app no slower for it.

Two things about Dictionarius are not up for trade (the brand): **it opens instantly,
whatever the size of the word bank**, and **it grows by language packs** (ADR-0005). The
FM-index is why both hold: one search costs microseconds, independent of how many words a
pack has, and the index loads as one file.

Conditions on letters and positions are a different shape of question: "which words have
property P?", a set over word ids. Sets over ids are what bitmaps do best, and the app
already has exactly one place where such sets meet the search: `WordFilter`, the compiled
bitmap of hidden words with a rank directory, which every count, the position slider,
landing and paging already read (ADR-0003). A letter or pattern condition becomes one more
set in that union. After it's built, searching costs what it does today: one bit test per
word found, ranks in O(1).

A bitmaps-only engine (bit-sliced positions doing substring search too) was considered and
is simpler on paper (see options), but every keystroke would scan the whole pack, and that
cost grows with every pack. It would trade away the brand to save code.

## Decision drivers

- The instant start and per-keystroke speed stay as they are, for any pack size: nothing
  new on the path from opening the app to the first result.
- Exact counts for every combination, as today.
- Any boolean combination of letter and position conditions (AND, OR, NOT, nesting), each
  answered by whole-bitmap operations, never a scan of words one by one at search time.
- Per language pack: each pack brings its own alphabet and its own bitmaps, built with its
  index (ADR-0005's `KEYHASH` rule).
- Sizes and timings are measured before they're built on.
- No WebAssembly (the page's Content Security Policy rules it out): plain JavaScript typed
  arrays.

## Considered options

1. **Letters only (a letter-mask column).** Cheap and covers "contains / doesn't contain".
   No positions, so no patterns. Kept as step 1 of the chosen option.
2. **Hybrid: the FM-index for pieces; bitmaps for letters and positions, compiled into the
   one filter** (chosen).
3. **Bitmaps only** (bit-sliced positional columns doing substring search as well, after
   O'Neil & Quass 1997 and BitWeaving, Li & Patel 2013). One primitive for everything,
   counts instant, ids free to follow rank order. But every keystroke scans the pack
   (about 19M word operations for a three-letter piece over 1.36M words: a few ms on a
   desktop, 10–25 ms estimated on a phone, unmeasured), the cost grows linearly with each
   pack, and ends-with needs a second set of planes. Rejected: it gives up the instant,
   any-size search the app is built on.
4. **Every substring in a hash table** (true O(1) lookup of any piece). About 70M+
   distinct substrings: hundreds of MB. Rejected.

## Decision

### 1. The FM-index stays the search engine

Pieces (mid-word, prefix, ends-with), the order of results (position, then rank) and the
per-position counts stay with the FM-index, unchanged. Loading it stays the only thing
between opening the app and the first search.

### 2. Conditions compile into the one filter

A search is `piece ∧ condition`, where `condition` is a boolean expression over atoms:
the existing column filters (length, frequency, names, safe search), plus the new letter
and position atoms. The expression compiles to one bitmap (bitwise AND / OR / NOT over
42,418 32-bit words per operand for 1.36M words) and joins `WordFilter`'s union. It's built
when the condition changes, never per keystroke.

With no piece typed, a condition alone defines the list: its count is a popcount of the
compiled bitmap, and its words are listed in id order (alphabetical; see open questions).

### 3. Letters: a mask column, bitmaps built from it

- **`LTRS` column** (layer 1, beside `LEN`, `NAME`, …): one mask per word saying which of
  the pack's letters it contains. 32 bits by default (a–z plus 6 flags: hyphen, space,
  apostrophe, digit, a letter outside the alphabet, a double letter); 64 bits for packs
  whose alphabet needs it (Cyrillic has 33 letters).
- **Alphabet table** in the pack: which characters map to which bit (French folds `é` to
  `e`, or gives it its own bit: the pack decides), so one engine serves every language.
- **Per-letter bitmaps** (letter → words) are built from the column when a letter is first
  used in a condition (one pass, cached; about 170 KB each), so memory goes only to letters
  in use.

### 4. Positions: an optional bit-sliced layer

- **`<lang>.positions.bin`**, a new layer kind (ADR-0005 gets a fourth, *planes*): for each
  position `k` from the start, the letter's code as 5 bit-planes (one bit per word each),
  and the same counted from the end, for "second to last letter is …". "Letter at `k` is
  `x`" is 5 AND / AND-NOT operations over planes; a pattern is the AND of its letters.
- The file is **optional and loaded after the first screen** (in the background, as the
  definitions are today on the phone). Only pattern conditions need it; nothing else waits
  for it. A browser's loading screen covers it like the other files.
- Planes past a pack's longest word aren't stored; mostly empty planes compress well.

### 5. What the user sees

A three-state letter keyboard in the filter sheet (each key: *any* → *must have* → *must
not have*), one "at least one of" group, and a pattern field (`_a_e_`). These compile to
the expression of section 2. Arbitrary nesting is supported by the engine; the first UI
doesn't expose it. Counts stay exact and immediate, as for every filter now.

### 6. Packs

Each pack builds its own `LTRS`, alphabet table and planes in the same run as its index,
carrying its `KEYHASH`. A condition applies per pack (the alphabet is the pack's); a search
across packs merges results as ADR-0005 describes.

## Measurement gates

Bench scripts beside `bench/definitions_packing.py`, on a full build; results recorded here.

| Step | Gate |
|---|---|
| `LTRS` column | index grows ≤ 3.5 MB compressed; open time +≤ 5% |
| Keystroke speed with a letter condition on | first page p95 within 5% of no condition (golden queries, CPU slowed 4×) |
| Compiling a letter condition | ≤ 15 ms on CPU slowed 4× |
| Positions layer | file ≤ 12 MB compressed; a pattern compiles in ≤ 30 ms on CPU slowed 4×; adds nothing to the time to first search |
| Memory | letters in use + planes resident ≤ 30 MB on top of today |

## Consequences

- Letter and pattern searches with exact counts; the instant start and any-size search
  stay as they are, because nothing reaches the keystroke path except one bit test that
  already happens.
- One more column and one optional file per pack. A pack without the positions file still
  has letter conditions.
- `WordFilter` becomes the meeting point of every condition: column filters, letters,
  patterns. New conditions of the same shape (rhymes, syllable counts, letter counts) join
  the same way: a set over ids, compiled once.
- Two engines to keep in step (pieces in the FM-index, conditions in bitmaps), joined by
  word ids, which ADR-0005 already makes the spine.
- Conditions with two pieces (`eat` and `ion`) stay costly: the second piece has to be
  listed in full to become a set (about the time counting it takes today). Offered as an
  explicit "and also contains" step, cached, not computed per keystroke.

## Open questions

- Order of a condition-only list (no piece typed): alphabetical by id is free; by rank
  needs a sort of the set (or a rank-ordered id permutation, about 5 MB).
- Letter counts ("two e's"): 4 bits per letter per word, roughly three times the size of
  `LTRS`; worth it only if asked for.
- Whether the "double letter" flag earns its bit, or another flag does more.
- Whether the positions file ships in every APK or as part of an optional pack (ADR-0005's
  flavour question).
