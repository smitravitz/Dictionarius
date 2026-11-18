# ADR-0011: The slider's spread bands mark shares of the words, not mean ± standard deviations

- **Status:** Accepted
- **Date:** 2026-11-18
- **Deciders:** project owner
- **Related:** `web/spread-bands.ts`, `web/position-scale.ts` (`shareOf`), `web/offset-slider.ts`,
  `web/styles.css` (spread bands), `test/spread-bands.test.ts`, `e2e/positions.spec.ts`

## Context and problem statement

The position slider's histogram shows how many words have each number of letters before the
fragment. People scrubbing it asked to see how that spread is shaped: dotted lines over the
first and second standard deviations, with 68.3% on the middle band, and so on. The lines
should help the histogram, not compete with it.

## Decision drivers

- The labels must be true. A printed 68.3% has to mean 68.3% of the words in this list.
- Quiet: the bars and the magenta chosen bar stay the focus.
- Nothing moves after it appears.

## Considered options

1. **Shares of the words** (chosen): lines where the middle 68.3% and 95.4% of the words begin
   and end, with words spread evenly across each bar's width.
2. **Mean ± 1 and 2 standard deviations**, labelled 68.3% and 95.4%. Those figures only hold
   for a bell curve, and word counts by position are lopsided. Across the 300 most common
   three-letter fragments in a public English word list (web2), mean ± 1 SD held between 54%
   and 91% of the words, and mean − 2 SD fell before 0 letters for about two in three. For
   "pre", ± 1 SD held 86% and both lower lines fell off the scale.
3. **Mean ± SD labelled with the share each band really holds.** True, but the numbers change
   from list to list, and a line before 0 letters still has nowhere to go.

## Decision

Option 1. `spreadBands()` finds where 2.275%, 15.865%, 84.135% and 97.725% of the words have
been passed (the shares a bell curve leaves outside ±2 and ±1 SD), as fractional positions.
`PositionScale.shareOf()` places a fractional position on the uneven scale. The slider draws
four 1px dotted pencil lines behind the bars, the inner pair stronger than the outer, and labels
the bands 13.6%, 68.3% and 13.6% in a 14px ruler under the bars. A band under 30px wide goes
unlabelled. Bands are drawn only once every position is counted, so they never shift; the ruler
keeps its height either way.

## Consequences

- The labels hold for every list, and a lopsided list shows its lopsidedness: the bands
  lean toward its long tail.
- The slider is 14px taller.
- The bands read left to right whichever hand holds the phone, like the bars.

## Evidence

Measured on the web2 word list (English, about 234,000 words), not the app's own headwords:
the shape carries over, the exact figures won't.

## Open questions

- None.
