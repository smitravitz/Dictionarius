# Architecture Decision Records

Short, immutable records of significant architecture decisions: the context, the
choice, and its consequences. New decisions get the next number; a decision that
replaces an older one marks the old one `Superseded by ADR-XXXX` rather than
editing it.

Format: Status · Context · Decision drivers · Considered options · Decision ·
Consequences · Evidence · Open questions.

| # | Title | Status |
|---|-------|--------|
| [0001](0001-frequency-tiered-gloss-storage.md) | Frequency-tiered gloss storage with an always-complete headword index | Accepted; the Core/Tail split superseded by 0004 |
| [0002](0002-offline-only-data-packs.md) | The app never connects; more definitions arrive as a file the user brings | Superseded by 0004 (never accepted) |
| [0003](0003-filters-from-word-columns.md) | Filters read per-word columns in the index, through one compiled filter | Accepted |
| [0004](0004-all-definitions-bundled.md) | Every definition ships inside the app, packed with brotli | Accepted; amended: one short example per meaning |
| [0005](0005-layered-data-packs.md) | Word ids as the spine; data in layers; a language is a pack | Proposed |
| [0006](0006-letter-and-position-bitmaps.md) | FM-index stays the engine; letters and positions as bitmaps beside it | Proposed |
| [0007](0007-derived-pronunciations.md) | Pronunciations for the words Wiktionary gives none, worked out from their parts | Proposed (planning only) |
| [0008](0008-web-start-in-layers.md) | The web app starts from a small starter; the rest loads behind it and stays on the device | Accepted |
| [0009](0009-installable-web-app.md) | The web app installs as an app, and an installed app behaves like the Android one | Accepted |
| [0010](0010-store-distribution.md) | One build for every shelf: Google Play and the App Store beside GitHub | Accepted |

## Decisions anticipated (not yet recorded)

- **Search index:** FM-index (compressed self-index) over headwords vs SQLite
  FTS5 trigram. Benchmarked (`bench/fmbench.py`): FM measured 2.3× smaller +
  faster than FTS5 trigram; ~8× projected engineered. To be written up once the
  engineered build is confirmed with a real succinct library.
- **Stack:** TypeScript core + Capacitor (web / PWA / iOS / Android / F-Droid).
