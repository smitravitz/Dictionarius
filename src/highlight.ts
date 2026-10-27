/**
 * Where a typed fragment sits inside a word as it is displayed, so the UI can
 * highlight it and align rows on it. Matching uses the same folding as
 * normalize() (NFD, strip diacritics, lowercase) but letter by letter, keeping
 * a map back to the displayed characters.
 */
export interface Split {
  before: string;
  match: string;
  after: string;
}

/** Fold one character for matching. Final sigma is folded to plain sigma,
 *  because lowercasing letter by letter can't see word endings. */
function fold(ch: string): string {
  return ch.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/ς/g, "σ");
}

/** Split `display` around the first occurrence of `query` (a normalized
 *  search key), or null when it doesn't occur. */
export function splitOnFragment(display: string, query: string): Split | null {
  if (query === "") return null;
  const chars = Array.from(display); // whole code points, so emoji stay intact
  let folded = "";
  const owner: number[] = []; // owner[j] = index in chars that produced folded[j]
  chars.forEach((ch, i) => {
    const f = fold(ch);
    folded += f;
    for (let j = 0; j < f.length; j++) owner.push(i);
  });

  const at = folded.indexOf(query.replace(/ς/g, "σ"));
  if (at < 0) return null;
  const start = owner[at];
  const end = owner[at + query.length - 1] + 1;
  return {
    before: chars.slice(0, start).join(""),
    match: chars.slice(start, end).join(""),
    after: chars.slice(end).join(""),
  };
}
