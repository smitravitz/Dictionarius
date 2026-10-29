/**
 * What a word's entry shows, from its definitions (src/definitions.ts): each
 * written form's word classes in order, numbered meanings with their labels,
 * and safe search's meanings left out and counted. The peek, shown while a
 * word in the results is held, is the start of the same view.
 */
import type { Definition } from "./definitions";

/** Wiktionary's part-of-speech codes, as a reader would say them. Others show as given. */
const PARTS_OF_SPEECH: Record<string, string> = {
  adj: "adjective",
  adv: "adverb",
  name: "proper noun",
  prep: "preposition",
  prep_phrase: "prepositional phrase",
  postp: "postposition",
  pron: "pronoun",
  conj: "conjunction",
  intj: "interjection",
  det: "determiner",
  num: "numeral",
  abbrev: "abbreviation",
  punct: "punctuation",
};

/** A tappable word inside a gloss: its text there, and the word it opens. */
export interface Link {
  text: string;
  word: string;
}

export interface MeaningView {
  n: number;
  gloss: string;
  labels: string[];
  /** the words to link: a plural's or spelling's own word, then Wiktionary's links */
  links: Link[];
  /** one short example of the meaning in use */
  example?: string;
}

export interface ClassView {
  form: string;
  pos: string;
  meanings: MeaningView[];
}

export interface EntryView {
  classes: ClassView[];
  /** meanings safe search left out */
  hidden: number;
  /** the main written form's pronunciations, each once */
  ipa: string[];
  /** where the word comes from, when its word classes share one origin; a
   *  word with several (lead: the metal, to guide) gets none until the
   *  planned Etymology section shows each with its classes */
  origin?: string;
}

export interface PeekView extends ClassView {
  /** meanings in the entry beyond the ones shown */
  more: number;
  hidden: number;
}

/** A word's entry: with `safe`, vulgar, offensive and slur meanings are left out. */
export function entryView(definitions: readonly Definition[], { safe }: { safe: boolean }): EntryView {
  let hidden = 0;
  const origins = new Set<string>();
  const classes: ClassView[] = [];
  const ipa: string[] = [];
  for (const d of definitions) {
    if (d.form === definitions[0].form) for (const p of d.ipa ?? []) if (!ipa.includes(p)) ipa.push(p);
    const shown = safe ? d.meanings.filter((m) => !m.explicit) : d.meanings;
    hidden += d.meanings.length - shown.length;
    if (shown.length === 0) continue;
    const view: ClassView = {
      form: d.form,
      pos: d.pos ? (PARTS_OF_SPEECH[d.pos] ?? d.pos.replace(/_/g, " ")) : "",
      meanings: shown.map((m, i) => {
        const meaning: MeaningView = { n: i + 1, gloss: m.gloss, labels: m.labels ?? [], links: linksOf(m) };
        if (m.example) meaning.example = m.example;
        return meaning;
      }),
    };
    if (d.etymology) origins.add(d.etymology);
    classes.push(view);
  }
  const [origin] = origins;
  return origins.size === 1 ? { classes, hidden, ipa, origin } : { classes, hidden, ipa };
}

/** The peek: the first word class's first `count` meanings; null when nothing is left to show. */
export function peekView(view: EntryView, count = 2): PeekView | null {
  const first = view.classes[0];
  if (!first) return null;
  const meanings = first.meanings.slice(0, count).map(({ example: _example, ...m }) => m); // a peek is meanings only
  const total = view.classes.reduce((sum, c) => sum + c.meanings.length, 0);
  return { ...first, meanings, more: total - meanings.length, hidden: view.hidden };
}

/** A meaning's links: its plural's or spelling's words, then Wiktionary's, each once. */
function linksOf(m: Definition["meanings"][number]): Link[] {
  const links: Link[] = (m.of ?? []).map((w) => ({ text: w, word: w }));
  for (const [text, word = text] of m.links ?? []) {
    if (!links.some((l) => l.text === text && l.word === word)) links.push({ text, word });
  }
  return links;
}

/**
 * A gloss split into plain text and links, in reading order: each link claims
 * the first place its text appears that no earlier link took. A link whose
 * text the gloss doesn't spell out (a plural's word, now and then) follows it
 * after an arrow.
 */
export function glossParts(gloss: string, links: readonly Link[]): (string | Link)[] {
  const placed: { at: number; link: Link }[] = [];
  const missing: Link[] = [];
  for (const link of links) {
    let at = gloss.indexOf(link.text);
    while (at >= 0 && placed.some((p) => at < p.at + p.link.text.length && p.at < at + link.text.length)) {
      at = gloss.indexOf(link.text, at + 1);
    }
    if (at >= 0) placed.push({ at, link });
    else missing.push(link);
  }
  placed.sort((a, b) => a.at - b.at);
  const parts: (string | Link)[] = [];
  let cursor = 0;
  for (const { at, link } of placed) {
    if (at > cursor) parts.push(gloss.slice(cursor, at));
    parts.push(link);
    cursor = at + link.text.length;
  }
  let tail = gloss.slice(cursor);
  missing.forEach((link, i) => {
    tail += i === 0 ? " → " : ", ";
    parts.push(tail);
    parts.push(link);
    tail = "";
  });
  if (tail) parts.push(tail);
  return parts;
}
