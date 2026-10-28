/**
 * Example fragments on the start screen. Each one was checked by hand on the
 * full word list: its first results are everyday words. Check any new one the
 * same way before adding it.
 */
export type Where = "start" | "middle" | "end";

export const EXAMPLES: readonly (readonly [fragment: string, where: Where])[] = [
  ["ate", "end"],
  ["ease", "end"],
  ["ing", "end"],
  ["tion", "end"],
  ["pre", "start"],
  ["ough", "middle"],
  ["ology", "end"],
  ["micro", "start"],
  ["ight", "middle"],
  ["ness", "end"],
  ["photo", "start"],
  ["zz", "middle"],
  ["able", "end"],
  ["sun", "start"],
  ["eau", "middle"],
  ["ment", "end"],
  ["tele", "start"],
  ["ngst", "middle"],
  ["ship", "end"],
  ["water", "start"],
  ["ound", "middle"],
  ["ful", "end"],
  ["astro", "start"],
  ["ook", "middle"],
  ["hood", "end"],
  ["snow", "start"],
  ["ock", "middle"],
  ["scope", "end"],
  ["bio", "start"],
  ["light", "middle"],
  ["ward", "end"],
  ["geo", "start"],
  ["graph", "end"],
  ["aqua", "start"],
  ["ous", "end"],
  ["moon", "start"],
  ["wise", "end"],
  ["hydro", "start"],
  ["ture", "end"],
  ["star", "start"],
  ["less", "end"],
  ["auto", "start"],
  ["ity", "end"],
  ["book", "start"],
  ["phone", "end"],
  ["over", "start"],
  ["cracy", "end"],
  ["under", "start"],
  ["anti", "start"],
  ["sea", "start"],
  ["qu", "start"],
];

/** How a chip shows where the fragment usually sits: "…ing", "pre…", "…ough…". */
export function exampleLabel(fragment: string, where: Where): string {
  if (where === "start") return `${fragment}…`;
  if (where === "end") return `…${fragment}`;
  return `…${fragment}…`;
}
