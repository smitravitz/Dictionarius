# ADR-0001: Frequency-tiered gloss storage with an always-complete headword index

- **Status:** Accepted
- **Date:** 2026-09-30
- **Deciders:** project owner
- **Related:** `bench/fmbench.py`, `bench/sizemodel_full.py`, `bench/tiers.py` (reproducible measurements)

## Context and problem statement

Dictionarily ships a full English dictionary (~1,390,507 headwords, per the Kaikki
extraction of English Wiktionary) that must run offline on the web, as a PWA,
and on iOS / Android / F-Droid, on low-end hardware ("runs on a potato").

Measurement (see Evidence) established two facts that drive this decision:

1. **Definitions dominate size.** Definition text is ~21× the headword text.
   The full definition set is ~90–100 MB; headwords are a small fraction.
2. **The differentiator (mid-word search) is a small slice of size.** An
   FM-index over *all* headwords is ~9.5 MB (projected engineered) — roughly
   7–9% of a full-definition app. The size problem is glosses, not search.

Shipping all ~100 MB on first run hurts install/adoption, yet users must be able
to look up *any* word, including rare ones (the main reason to open a dictionary).

## Decision drivers

- First-run size must be small enough to not deter install (hook users lean).
- **Every** word must be searchable offline from first run — a "not found" for a
  real word is unacceptable; "definition loads on demand" is fine.
- Substring / mid-word search is a core feature (see ADR on the search index).
- FLOSS / F-Droid: no proprietary deps; data is CC-BY-SA (Wiktionary).

## Considered options

1. **Ship everything (~106 MB) bundled.** Simple, fully offline. Rejected as the
   *default*: too heavy for first run; kept as an optional pre-download.
2. **Prefix-only lookup + block-compressed defs** (the StarDict / Aard2 pattern).
   Rejected: no substring search, our core feature.
3. **Frequency-tiered glosses + complete headword index (chosen).** Small core,
   every word searchable, rare definitions on demand or pre-downloaded.

## Decision

Ship a **frequency-tiered** data model:

- **Core bundle (~15 MB, ships with the app):**
  - FM-index over **all ~1.39M headwords** (~9.5 MB projected; measured
    10.7 MB download / 26.8 MB in memory, see Update) — every word searchable,
    instant mid-word matching, fully offline.
  - Full definitions for the **top 50,000 headwords by word frequency**
    (~5.7 MB) — ~100% of text-frequency lookups.
- **Tail (~1.34M remaining definitions, ~90 MB):** not bundled. Served as
  **frequency-banded blocks** from a static host.
  - **On demand (default):** tapping a sub-core word fetches its block; fetched
    definitions are **cached locally** and merge into the offline store, so the
    user's offline set grows with use.
  - **Pre-download (optional):** a home-page "download everything" action and an
    in-form "download the rest" toggle fetch the full tail for total offline use.
- **Other fields** (IPA, etymology, examples, audio) remain separate opt-in
  add-ons (see the modular-addons decision), not part of this tier.

The tier boundary is **top 50k** rather than the ~20k Zipf knee: dictionary
*lookup* frequency is flatter than *reading* frequency (people look up rare
words), so 50k buys headroom against that skew at a trivial +1.9 MB over 20k.

## Consequences

**Positive**
- ~15 MB first run; every word searchable offline immediately.
- The heavy tail is opt-in; "runs on a potato" holds for the core.
- Core gloss size is ~scale-invariant: the top-50k words are the same words
  regardless of total dictionary size, so this number is robust as data grows.

**Negative / costs**
- The tail requires a **static host** (CDN / GitHub Releases / IPFS). "Fully
  offline" is therefore precise only for the core; **claims must read
  "works fully offline; rare definitions fetch on demand or pre-download."**
- Two code paths (bundled vs fetched-and-cached) and a cache/merge store to
  maintain.
- Requires a per-headword **frequency ranking** in the build pipeline.

## Evidence (measured this cycle; reproducible)

- English Wiktionary / Kaikki: **1,390,507** distinct words (kaikki.org).
- Size split (102,217 real entries, Webster's 1913 public-domain proxy —
  Kaikki download was network-blocked in the build sandbox):
  - definition text ≈ **21×** headword text.
  - FM-index (engineered model) ≈ **7–9%** of total app size.
- Gloss tiers (ranked by real English frequency via `wordfreq`):
  - top 20k → 3.8 MB glosses, ~99.6% coverage
  - **top 50k → 5.7 MB glosses, ~100% coverage (chosen)**
  - all defs → ~7.3 MB (102k proxy) → ~90–97 MB projected at full scale
- Confidence: 🟢 relative proportions and the tier curve are measured;
  🟡 full-scale absolute tail size is extrapolated from the Webster proxy and
  must be re-measured on the real Kaikki dump.

### Update 2026-10-27 — headword index measured on real data

Built from the English Wiktionary raw extract (11.1M lines, all languages,
filtered to English) with `scripts/build_fm_index.py`, format v1:

- 1,499,161 English headwords → **1,357,380 unique search keys** (case and
  diacritic variants share a key; 294,617 keys keep display forms).
- Index: **26.8 MB in memory, 10.7 MB gzip download.** BWT 15.4 MB, rank
  tables 3.7 MB, frequencies 2.6 MB, display forms 5.1 MB.
- The earlier ~9.5 MB figure was an *engineered* (compressed-BWT) projection;
  format v1 keeps the BWT uncompressed so the app can search it without
  decoding. The core is therefore ~16 MB to download and ~32 MB in memory
  (with the projected 5.7 MB of core definitions), not ~15 MB. The decision
  stands; only the number moved.
- Later the same day a 2.2 MB **hot list** (keys of the top 200,000 words in
  rank order) was added so mid-word results are instant (`tion`: 223 ms →
  3 ms for the first page). Index now **29.0 MB in memory, 12.4 MB gzip**.

## Open questions (resolve before build)

1. **Tail host:** GitHub Releases vs CDN vs IPFS (FLOSS-friendly, durable).
2. **Block granularity:** frequency band size (requests vs compression tradeoff).
3. **Cache store format:** appendable, same gloss-block format as core.
4. **Re-measure on real Kaikki** to replace the Webster proxy tail figure.
   *Headword index done (Update above); definitions still to measure.*
