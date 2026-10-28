# CONTEXT — domain glossary

The shared vocabulary for Dictionarius. Code, tests, and ADRs use these terms
exactly, so names line up across the codebase. Add a term here the first time a
decision or module makes it load-bearing.

## Data & content

- **Headword** — the word being defined; the search key. All headwords are
  always present and searchable (see ADR-0001).
- **Entry** — a headword plus its senses and attribution.
- **Sense** — one meaning of a headword: part of speech + gloss.
- **Gloss** — the definition text of a sense. The bulk of app size.
- **Attribution** — the source + license carried by every entry (CC-BY-SA).

## Storage tiers (ADR-0001)

- **Core** — bundled data shipped with the app: the headword index over *all*
  words + full glosses for the top-50k by frequency. ~15 MB, fully offline.
- **Tail** — glosses for words outside the core (~1.34M).
- **Data pack** — the Tail as a file attached to a GitHub release, its checksum
  pinned in the repository. "Get the full dictionary" opens its download link in
  the user's browser; "Import a data pack" reads it through the system file
  picker. The app itself never connects (ADR-0002, proposed; it replaces
  ADR-0001's on-demand fetch, pre-download and local cache).

## Search

- **Headword index** — the structure that answers "which words match?" — an
  FM-index (compressed self-index) giving substring / mid-word search.
- **Mid-word / substring match** — finding a word by an interior fragment
  (`eren` → `serene`), not only a prefix.
- **Completer / Matches** — the live search over the Headword index
  (`src/complete.ts`): the exact match, then words by position, ranked.
- **Position** — how many characters come before the match in a headword
  (0 = the headword starts with the typed text).
- **Position slider** — hold a blank spot in the results and slide sideways to
  jump to a position. Its **active range** is the middle 80% of the screen; the
  **position scale** (`web/position-scale.ts`) gives positions 4–6 the most
  room, puts 6 at about 75%, and squeezes positions 8 and up into the last 18%.
  Held from the right half of the screen (a right thumb), the thumb's direction
  flips: 0 at the right edge, more letters leftward. The histogram still reads
  left to right.
- **Scroller gestures** — what a press on the results means, decided in one
  place (`web/scroller-gestures.ts`): a **tap** opens a word (on a touch screen
  while typing, it only puts the keyboard away); a **hold** on a blank spot
  opens the position slider; a hold on a word is reserved; a moving finger
  scrolls; the mouse drags the list or a row.
- **Filter** — a rule that leaves words out of every search (`src/filters.ts`):
  a **switch** in Settings (safe search; *Disable phrases*, entries with spaces;
  *Disable names*, proper nouns; all on by default, so only common words show)
  or a **range** in the **Filters panel** under the cog (word length, set with
  two **roller wheels**, Min and Max: each starts on "Any"; Max starts from the
  chosen minimum, and a new minimum puts Max back on Any). Filters read
  **word columns** in the index (`LEN`, `NAME`, `SHAPE`); a choice compiles to
  one **WordFilter** that every list and count goes through (ADR-0003).
- **DictionarySource** — the seam for definitions (`getByHeadword`,
  `getCandidates`); mock, SQLite, and FM-index sources are interchangeable
  behind it. The web app doesn't use it yet: its search runs on the Completer.

## Privacy

- **Privacy budget** — `privacy.toml`: the permissions, servers and link targets
  the app may use. Today: no permissions, no servers. `scripts/audit_privacy.py`
  checks code and built APKs against it in CI.
