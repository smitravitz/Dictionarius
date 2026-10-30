/**
 * The bag of pieces on the start screen: general, telling pieces of English
 * words (where a piece usually sits in them, and how many words it finds),
 * mixed so big and small sit together, four to a row.
 *
 * `words` is how many search keys the piece finds in the full index (all
 * 1,357,380, phrases and names included), counted with the builder's index
 * reader for data-4c057f0a: keys starting with it, ending with it, or holding
 * it anywhere. It only sizes the tiles, a little; it isn't shown. Before
 * adding a piece, check by hand that its first results are everyday words.
 */
export type Where = "start" | "middle" | "end";

export const EXAMPLES: readonly (readonly [fragment: string, where: Where, words: number])[] = [
  ["tion", "end", 20603],
  ["un", "start", 28333],
  ["ough", "middle", 3259],
  ["ness", "end", 12363],
  ["qu", "middle", 21581],
  ["ology", "end", 2459],
  ["re", "start", 30118],
  ["tch", "middle", 8288],
  ["able", "end", 8826],
  ["hood", "end", 784],
  ["ing", "end", 53595],
  ["over", "start", 7238],
  ["ight", "middle", 8204],
  ["ship", "end", 1705],
  ["ous", "end", 9031],
  ["pre", "start", 9010],
  ["less", "end", 4007],
  ["ph", "middle", 50788],
  ["under", "start", 3565],
  ["ment", "end", 3620],
];

export const PER_ROW = 4;

/** How a tile shows where the piece usually sits: "…ing", "pre…", "…ough…". */
export function exampleLabel(fragment: string, where: Where): string {
  if (where === "start") return `${fragment}…`;
  if (where === "end") return `…${fragment}`;
  return `…${fragment}…`;
}

/** Where a piece's word count falls between the bag's fewest and most, on a
 *  log scale: 0 for the fewest, 1 for the most (a tile's size follows it). */
export function tileWeight(words: number, all: readonly number[]): number {
  const lo = Math.log(Math.min(...all));
  const hi = Math.log(Math.max(...all));
  return hi > lo ? (Math.log(words) - lo) / (hi - lo) : 0.5;
}
