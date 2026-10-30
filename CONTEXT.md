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
- **Start screen** — what shows with nothing typed: a title page (the name set
  large, what Dictionarius does, a worked example, the word count), the field,
  and the **bag of pieces** (`web/examples.ts`): twenty general pieces of words
  ("…tion", "un…", "…ough…"), four to a row, each tile a little bigger the more
  words it finds. Typing brings back the usual header.
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
- **Edge strips** — in the Android app, a strip down each side of the results,
  centred on their lower half, where the phone's own edge swipe (Back) is
  turned off, so a thumb holding the slider's ends isn't taken away mid-slide
  (`web/edge-gestures.ts`, `EdgeGesturesPlugin`). Android allows 200 dp per
  edge.
- **Filter** — a rule that leaves words out of every search (`src/filters.ts`):
  a **switch** in Settings (safe search; *Disable phrases*, entries with spaces;
  *Disable names*, proper nouns; all on by default, so only common words show)
  or a **range** in the **Filters panel** under the cog (word length, set with
  two **roller wheels**, Min and Max: each starts on "Any"; Max starts from the
  chosen minimum, and a new minimum puts Max back on Any). Filters read
  **word columns** in the index (`LEN`, `NAME`, `SHAPE`); a choice compiles to
  one **WordFilter** that every list and count goes through (ADR-0003).
- **Definitions file** — every word's definitions, beside the index, read by
  word id (`src/definitions.ts`, `docs/definitions-format.md`; ADR-0004): per
  written form, a **word class** (Wiktionary's part of speech) with numbered
  **meanings** (gloss, usage **labels**, a safe-search flag), the words a
  plural or spelling is **of**, **links** inside the gloss (as on Wiktionary),
  one short **example** of the meaning in use, **pronunciation** and
  **etymology**. Tied to the index by `KEYHASH`.
- **Entry** — a word's page: its definitions shaped by `src/entry-view.ts`
  (safe search's meanings left out and counted), drawn whole once they are in.
  Pronunciations fold to two lines and the **origin brief** to three, with
  more/less (`web/clamp.ts`). The origin brief is the word's etymology when
  all its word classes share one; a word with several gets none until the
  planned **Etymology section** shows each origin with its classes.
- **Trail** — the words followed since leaving the results, kept as a browser
  keeps history (`src/trail.ts`): opening a word from the results starts one,
  following a link adds to it. A **swipe** (a quick sideways flick,
  `web/swipe.ts`) steps along it: rightward back, leftward forward. Back goes
  straight to the results, keeping the trail, so a swipe leftward from there
  goes down it again.
- **Peek** — hold a word in the results to see its first two meanings beside
  the row until the finger lifts (`web/peek.ts`).

## Privacy

- **Privacy budget** — `privacy.toml`: the permissions, servers and link targets
  the app may use. Today: no permissions, no servers. `scripts/audit_privacy.py`
  checks code and built APKs against it in CI.
