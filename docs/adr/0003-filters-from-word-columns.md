# ADR-0003: Filters read per-word columns in the index, through one compiled filter

- **Status:** Accepted
- **Date:** 2026-10-28
- **Deciders:** project owner
- **Related:** `src/filters.ts`, `docs/index-format.md` ("Word columns"), ADR-0001 (the headword index)

## Context and problem statement

Search needed more ways to leave words out than safe search: phrases (entries with spaces),
names (proper nouns), and a word-length range, with phrases and names left out by default so
only common words show. More will follow (other ranges, and sort orders over the same facts).
Safe search was a special case inside the Completer: its own hidden-id list, its own count of
hidden words starting with or ending in the query, its own setting in the worker protocol, and
a switch written by hand in the page. A second filter in that style would have meant a second
copy of each.

## Decision drivers

- Every list, count and position of a search must respect every filter, including rows that
  haven't been read yet (the list is paged and the slider reads per-position counts).
- A new filter should be a new entry, not edits across the Completer, worker, protocol, page
  and storage.
- The index must carry the facts filters need; the app can't afford to derive them per word at
  load (reading 1.36 M keys back out of the FM-index takes seconds).
- Size and speed: one byte per word is 1.4 MB on a 31 MB index; filters must not slow the first
  page.

## Considered options

1. **Word columns + one compiled filter (chosen).** The builder writes per-word *columns*:
   named sections holding one value per word id, `u8` (a byte each) or `bits` (a bit each).
   A registry (`FILTERS` in `src/filters.ts`) defines each filter over columns. A choice of
   filters compiles to one `WordFilter`: a bit per word plus running counts, so hidden words in
   any id range count in O(1).
2. **Separate indexes per class** (common words, phrases, names). Fast, but combinations
   multiply, a range filter can't be expressed, and the download grows with each split.
3. **Renumber word ids so a filter is a contiguous range.** Ids are in key order, which is what
   makes "words starting with" a single range; any other order breaks it, and only one filter
   could be contiguous anyway.
4. **Keep safe search's design and add the others beside it.** Rejected: each filter would add
   its own count of hidden words starting and ending with the query, and its own setting plumbing.

## Decision

- **Index:** per-word columns `LEN` (`u8`, characters per word, capped at 255) and `NAME`
  (`bits`, proper nouns: Wiktionary's part of speech `name` on the main meaning of the most
  common spelling, decided like safe search). `SHAPE` (`u8`) already marks phrases. Columns
  are read by name (`HeadwordIndex.column(name, type)`); a missing column means the filter
  that needs it isn't offered. `NAME` is written only when the data said parts of speech
  (a dump build, or a labels cache from one), so an index never claims "no names" for lack of
  data.
- **Registry:** `FILTERS` lists each filter once: id (the storage key), label, help, kind
  (`switch` drawn in Settings, `range` drawn as two roller wheels in the Filters panel), and
  the column or rule it reads. Safe search is one entry; its hand-picked list feeds it.
- **One pipeline:** `Completer.search(q, { filters })` compiles the choice (cached per
  choice) to a `WordFilter` that `Matches` uses for rows, starts, totals and per-position
  counts. The worker sends the filters the index can offer in its `ready` message; Settings and
  the Filters panel are drawn from that.
- **Ends with filters:** "N end with it" is counted as the positions are worked out (a word
  found at offset *o* ends with the query when *o* + query length = `LEN`), so it is exact once
  counting completes and shows "…" until then. Without filters it stays an instant count.

## Consequences

- Adding a filter over existing data: one `FILTERS` entry. Over new data: a column in the
  builder (`word_lengths` / `bitset` style), a row in "Word columns", and the entry. A sort
  option would read the same columns.
- Index +1.36 MB (`LEN`) and +0.17 MB (`NAME`) before compression.
- Names need parts of speech: an index rebuilt from an older labels cache has no `NAME`, and
  the Names switch isn't shown until the index is rebuilt from the dump.
- With filters on (the default), the end count arrives with the total: about 0.1 s for "ing",
  up to 1.5 s for a single letter on the full index (measured in Node). Previously safe search
  alone had it at once.
- Safe search's counting special case, `prepareSafeSearch`, and the `safe` protocol field are
  gone.

## Evidence

Full index (1,357,380 words), Node, `src/complete.ts` via `vite-node`:

| | first page | all counted |
|---|---|---|
| "e", no filters | 26 ms | 1.36 s |
| "e", defaults | 41 ms | 1.49 s |
| "ing", defaults | 1 ms | 0.13 s |
| "zz", defaults | 1 ms | 2 ms |

Compiling the defaults: 9 ms; with a length range: 14 ms. Offering filters at load: 16 ms.

## Open questions

- Months and days are proper nouns in Wiktionary, so "Disable names" hides them; an allow
  list for names (like safe search's) would be the place to keep any back.
