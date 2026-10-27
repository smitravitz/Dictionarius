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
- **Tail** — glosses for words outside the core (~1.34M), served as
  frequency-banded **blocks** from a static host.
- **On-demand fetch** — retrieving a tail block when a sub-core word is opened;
  the result is cached locally.
- **Pre-download** — optionally fetching the whole tail up front for total
  offline use.
- **Local cache** — the growing on-device store of fetched tail glosses.

## Search

- **Headword index** — the structure that answers "which words match?" — an
  FM-index (compressed self-index) giving substring / mid-word search.
- **Mid-word / substring match** — finding a word by an interior fragment
  (`eren` → `serene`), not only a prefix.
- **DictionarySource** — the seam every backend implements (`getByHeadword`,
  `getCandidates`); mock, SQLite, and FM-index sources are interchangeable
  behind it.
