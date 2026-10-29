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

export interface MeaningView {
  n: number;
  gloss: string;
  labels: string[];
  /** words a plural or spelling is of, to link to */
  of: string[];
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
}

export interface PeekView extends ClassView {
  /** meanings in the entry beyond the ones shown */
  more: number;
  hidden: number;
}

/** A word's entry: with `safe`, vulgar, offensive and slur meanings are left out. */
export function entryView(definitions: readonly Definition[], { safe }: { safe: boolean }): EntryView {
  let hidden = 0;
  const classes: ClassView[] = [];
  for (const d of definitions) {
    const shown = safe ? d.meanings.filter((m) => !m.explicit) : d.meanings;
    hidden += d.meanings.length - shown.length;
    if (shown.length === 0) continue;
    classes.push({
      form: d.form,
      pos: d.pos ? (PARTS_OF_SPEECH[d.pos] ?? d.pos.replace(/_/g, " ")) : "",
      meanings: shown.map((m, i) => ({ n: i + 1, gloss: m.gloss, labels: m.labels ?? [], of: m.of ?? [] })),
    });
  }
  return { classes, hidden };
}

/** The peek: the first word class's first `count` meanings; null when nothing is left to show. */
export function peekView(view: EntryView, count = 2): PeekView | null {
  const first = view.classes[0];
  if (!first) return null;
  const meanings = first.meanings.slice(0, count);
  const total = view.classes.reduce((sum, c) => sum + c.meanings.length, 0);
  return { ...first, meanings, more: total - meanings.length, hidden: view.hidden };
}
