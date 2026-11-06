# ADR-0007: Pronunciations for the words Wiktionary gives none, worked out from their parts

- **Status:** Proposed (planning only: nothing below is built; each step lands only after
  its measurement gate)
- **Date:** 2026-11-06
- **Deciders:** project owner
- **Builds on:** [ADR-0004](0004-all-definitions-bundled.md) (definitions from Wiktionary),
  [ADR-0005](0005-layered-data-packs.md) (the pronunciation layer, measurement gates)
- **Related:** `scripts/definitions.py` (where pronunciations are read from the dump),
  `scripts/missing-pronunciations.ts`, `bench/pronunciation_glue.py`

## Context and problem statement

Most words have no pronunciation. Many of them are made of words that do: *arthood* is
*art* + *-hood*, and Wiktionary's own etymology says so ("From art + -hood."). Could those
be worked out automatically, and which ones? Naively gluing the parts' pronunciations
together is right for some kinds of word and wrong for others; the problem is telling them
apart, and doing it without putting wrong pronunciations in front of people.

## Observations

Measured 2026-11-06 on the v0.6 data (1,356,572 words with definitions), with
`scripts/missing-pronunciations.ts` (`--tsv` for every word's pronunciations, etymologies
and base words) and `bench/pronunciation_glue.py`.

### How many, and what kind

| | Words |
|---|---|
| With a pronunciation | 99,370 (7.3%) |
| **Without** | **1,257,202 (92.7%)** |
| … a form of another word ("plural of …", "past tense of …") | 630,425 |
| … of which the base word has a pronunciation | 119,233 |
| … not a form, etymology naming its parts with "+" ("From art + -hood.") | 244,375 |
| … phrases (with a space) | 310,506 |

The groups overlap (a phrase can be a form of another phrase).

### What the data keeps, and loses

- Pronunciations are IPA strings from Wiktionary, several per word (*water* has 20:
  UK, US, Australian, broad and narrow), mixing phonemic `/…/` and phonetic `[…]`.
- **Their accent labels are dropped.** The builder keeps each sound's `ipa` and nothing
  else (`scripts/definitions.py`), so "UK" or "US" is lost. Gluing two parts can then mix
  accents into a pronunciation no one has.
- Wiktionary leaves the stress mark off one-syllable words (*art* /ɑːt/), writes optional
  sounds in brackets (*over-* /əʊvə(ɹ)/), and often leaves secondary stress unmarked.
- Affixes have entries of their own with pronunciations: *-hood* /hʊd/, *-ness* /nəs/,
  /nɪs/; some have several forms chosen by the sound before them (*-s* /s z ɪz/,
  *-ed* /t d ɪd/).

### How often gluing is right

Tested on the 11,716 words that have both a pronunciation and an etymology naming parts
that all have one. Gluing: the first word keeps its stress (a one-syllable word gets the
mark Wiktionary leaves off), affixes lose theirs, a later word's becomes secondary.
Compared with the word's own pronunciations, ignoring syllable dots and secondary stress.

- **Right 50% of the time** with each part's first transcription; **60%** with the best
  combination of the parts' transcriptions. The gap is mostly mixed accents (*de-*: 16%
  → 66%).

| Kind | Patterns (right with the best combination) | Why |
|---|---|---|
| Mostly right | *-ish* 88%, *-less* 86%, *a-* 86%, *-ing* 84%, *-ie* 84%, *un-* 81%, *-er* 80%, *-y* 80%, *be-* 80%, *-able* 78%, *pre-* 76%, *-ness* 75% | Germanic or "neutral" affixes don't move the stress |
| A coin-flip | compounds of two words 64% (2,745 tested), *-ly* 57%, *-al* 59%, *-ize* 55%, *-ism* 54% | stress varies; old compounds lose sounds (*cupboard*, *forehead*) |
| Never | *-ic* 12%, *-ity* 5%, *super-* 5%, *over-* 1%, *dis-* 1% | Latinate suffixes move the stress (*able* → *ability*); prefixes with stress of their own |

- **No pattern is good enough to publish unchecked.** The best, *-ish*, is wrong one time
  in eight.
- **The measure is strict:** exact text, so a harmless difference in notation counts as
  wrong. The true share is somewhat higher; how much is unknown (see open questions).
- Not yet measured: inflections by sound rule (step 2 below), and any second, independent
  source (step 4).

## Decision drivers

- A wrong pronunciation is worse than none: people trust what a dictionary says.
- Anything worked out is labelled as such, never passed off as Wiktionary's.
- Reproducible: derived at build time from the dump, the same way every build.
- Measured before trusted, per pattern, on words whose pronunciation is known (ADR-0005's
  gates).
- Offline and free: any helper is free software or openly licensed data, used at build
  time only; nothing in the app changes how it connects.

## Considered options

1. **Glue every word whose parts have pronunciations.** Covers the most; wrong about half
   the time (measured). Rejected.
2. **Generate every missing pronunciation with a letter-to-sound engine** (espeak-ng) or a
   model. Covers everything; quality unmeasured here, varies with spelling, and would sit
   unlabelled beside Wiktionary's. Rejected as the only source; kept as a cross-check.
3. **Planned: work out only what can be checked, by measured pattern, labelled.** Keep the
   accent labels; inflections by sound rule; gluing only for patterns that measure well;
   a second source must agree; everything else goes to a review list.

## Plan (not started)

Each step is measured on the words whose pronunciation is known before it fills in any
that aren't; the gates are below.

1. **Keep the accent labels.** Store each pronunciation's accent (UK, US, …) beside it in
   the pronunciation layer. Needed so parts are glued within one accent; lets the app show
   UK and US apart too. A format change (an additive field) and a rebuild.
2. **Inflections by sound rule.** For forms whose base word has a pronunciation (119,233):
   the base's, plus the ending its last sound calls for (*-s*: /s/, /z/ or /ɪz/; *-ed*: /t/,
   /d/ or /ɪd/; *-ing*: /ɪŋ/), where the spelling shows a regular form.
3. **Gluing by pattern.** For words whose etymology names their parts: only patterns that
   measure at or above the gate are filled in; the "never" list above never is. Re-measured
   after step 1, per accent.
4. **A second, independent source must agree.** CMUdict (BSD licence; US) or espeak-ng
   (GPL; build time only): a worked-out pronunciation is kept when the two agree, else it
   goes to review.
5. **Labelled.** Worked-out pronunciations carry a flag in the pronunciation layer and show
   as such in the app (for example "≈"); worked out again at every build, with each
   pattern's measured share in the build log.
6. **A review list.** The rest, as a table (word, parts, guess, alternatives, why it was
   left out), for a person. Corrections are best made in Wiktionary itself, where every
   dictionary built from it gets them.

## Measurement gates

| Step | Gate |
|---|---|
| Accent labels | every pronunciation keeps its label where the dump has one; pronunciation layer grows ≤ 20% |
| Inflections by sound rule | ≥ 95% right per rule on forms whose pronunciation is known |
| Gluing a pattern | ≥ 95% right on known words of that pattern, within one accent, after step 4's cross-check |
| Hand check of the measure | 50 "wrong" cases looked at: the share that are notation only, to correct the figures above |

## Consequences

- Fewer words without a pronunciation, but never by guessing in the open: everything added
  is checked, measured and labelled.
- The pronunciation layer gets two additive fields (accent, derived); a format change and
  a rebuild.
- The build gains a step and a dependency for the cross-check (data or a tool, build time
  only).
- The share of words with a pronunciation stays far from all: phrases and words whose
  parts have none aren't touched by this plan.

## Open questions

- How much of the measured error is notation, not sound (the hand check)?
- Which accent the app shows first, and whether it shows both.
- Phrases (310,506): word by word, or left alone? Stress across a phrase follows other
  rules.
- Whether the "≈" label is enough, or derived pronunciations should be opt-in.
- Which cross-check: CMUdict (US only, 134,000 words) or espeak-ng (any word, GPL).
