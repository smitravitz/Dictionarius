# Architecture Decision Records

Short, immutable records of significant architecture decisions: the context, the
choice, and its consequences. New decisions get the next number; a decision that
replaces an older one marks the old one `Superseded by ADR-XXXX` rather than
editing it.

Format: Status · Context · Decision drivers · Considered options · Decision ·
Consequences · Evidence · Open questions.

| # | Title | Status |
|---|-------|--------|
| [0001](0001-frequency-tiered-gloss-storage.md) | Frequency-tiered gloss storage with an always-complete headword index | Accepted; how the Tail arrives superseded in part by 0002 (proposed) |
| [0002](0002-offline-only-data-packs.md) | The app never connects; more definitions arrive as a file the user brings | Proposed |

## Decisions anticipated (not yet recorded)

- **Search index:** FM-index (compressed self-index) over headwords vs SQLite
  FTS5 trigram. Benchmarked (`bench/fmbench.py`): FM measured 2.3× smaller +
  faster than FTS5 trigram; ~8× projected engineered. To be written up once the
  engineered build is confirmed with a real succinct library.
- **Stack:** TypeScript core + Capacitor (web / PWA / iOS / Android / F-Droid).
- **Modular add-ons:** IPA, etymology, examples, audio as opt-in downloads
  behind the same source seam.
