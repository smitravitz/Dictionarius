/**
 * The suggestions on the start screen: general, telling pieces of English
 * words, shown plain ("tion", "ough", "ere"), in two slowly drifting lanes,
 * shuffled each time the app starts. Tapping one opens its words around the
 * middle of its list (src/landing.ts), so where the piece sits in a word
 * needn't be spelled out.
 *
 * `words` is how many times the piece occurs in the full index's 1,357,380
 * search keys (phrases and names included), counted with the builder's index
 * reader for data-4c057f0a. It only sizes the tiles, a little; it isn't shown.
 */
export const PIECES: readonly (readonly [piece: string, words: number])[] = [
  ["tion", 43232],
  ["ough", 3259],
  ["ology", 2495],
  ["ing", 102557],
  ["ness", 14639],
  ["ment", 10382],
  ["able", 11717],
  ["ight", 8204],
  ["ere", 14037],
  ["qu", 21581],
  ["tch", 8288],
  ["ph", 50788],
  ["ous", 17097],
  ["ship", 3456],
  ["hood", 1158],
  ["less", 6459],
  ["ful", 4907],
  ["ism", 11978],
  ["ance", 5147],
  ["ence", 5018],
  ["ward", 1813],
  ["graph", 5644],
  ["port", 3123],
  ["spect", 1202],
  ["ject", 1619],
  ["ture", 3488],
  ["un", 71076],
  ["re", 143541],
  ["pre", 13926],
  ["over", 11032],
  ["under", 4821],
  ["inter", 6218],
  ["trans", 5137],
  ["sub", 7481],
];

/** Lanes of suggestions on the start screen. */
export const LANES = 2;

/** Where a piece's word count falls between the fewest and most, on a log
 *  scale: 0 for the fewest, 1 for the most (a tile's size follows it). */
export function tileWeight(words: number, all: readonly number[]): number {
  const lo = Math.log(Math.min(...all));
  const hi = Math.log(Math.max(...all));
  return hi > lo ? (Math.log(words) - lo) / (hi - lo) : 0.5;
}

/** `items` shuffled, then dealt into `lanes` lanes in turn (sizes differ by one at most). */
export function lanesOf<T>(items: readonly T[], lanes: number, random: () => number = Math.random): T[][] {
  const deck = [...items];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const out: T[][] = Array.from({ length: lanes }, () => []);
  deck.forEach((item, i) => out[i % lanes].push(item));
  return out;
}
