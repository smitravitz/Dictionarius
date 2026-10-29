/**
 * Draws a word's definitions (src/entry-view.ts shapes them): on the entry
 * page, its pronunciations and origin brief (folded when long), then every
 * word class with numbered meanings whose linked words open their own
 * entries, as on Wiktionary, each followed by an example of its use; in the
 * peek card, the first meanings only.
 */
import { glossParts, type EntryView, type MeaningView, type PeekView } from "../src/entry-view";
import { clamp } from "./clamp";

/** Opens the word a link names. */
export type OpenWord = (word: string) => void;

/** The entry page's parts, filled together so it never shows half drawn. */
export interface EntryParts {
  word: HTMLElement;
  forms: HTMLElement;
  body: HTMLElement;
  note: HTMLElement;
}

/** What the page shows for a word: its definitions, none (null), or that
 *  they're still on their way (the definitions file is loading). */
export type EntryContent = EntryView | null | "loading";

/** Fill the whole entry page at once. A word class under another written form
 *  names that form; the title names the word as the results showed it. */
export function renderEntry(
  parts: EntryParts,
  word: { display: string; forms: readonly string[] },
  content: EntryContent,
  open: OpenWord,
) {
  parts.word.textContent = word.display;
  const others = word.forms.filter((f) => f !== word.display);
  parts.forms.textContent = others.length ? `Also written ${others.join(", ")}` : "";
  const view = content === "loading" ? null : content;
  const body: Node[] = [];
  if (view?.ipa.length) {
    const ipa = el("p", "entry-ipa");
    ipa.textContent = view.ipa.join(" · ");
    body.push(clamp(ipa, 2));
  }
  if (view?.origin) {
    const origin = el("p", "entry-origin");
    origin.textContent = view.origin;
    body.push(clamp(origin, 3));
  }
  for (const c of view?.classes ?? []) {
    const section = el("section", "word-class");
    const head = el("h3", "word-class-head");
    const form = el("span", "word-class-form");
    form.textContent = c.form === word.display ? "" : c.form;
    const name = el("span", "word-class-name");
    name.textContent = c.pos;
    head.append(form, name);
    section.append(head, meanings(c.meanings, open));
    body.push(section);
  }
  parts.body.replaceChildren(...body);
  const { note } = parts;
  note.hidden = false;
  if (content === "loading") note.textContent = "Loading the definitions…";
  else if (!view) note.textContent = "No definition for this word in the app yet.";
  else if (view.hidden) note.textContent = `${view.hidden} ${view.hidden === 1 ? "meaning" : "meanings"} hidden by safe search.`;
  else note.hidden = true;
}

/** Fill the peek card: the word, its first word class and meanings, and how many more. */
export function renderPeek(card: HTMLElement, word: string, peek: PeekView | null, nothing: string) {
  card.replaceChildren();
  const head = el("p", "peek-head");
  const title = el("span", "peek-word");
  title.textContent = word;
  head.append(title);
  card.append(head);
  if (!peek) {
    const note = el("p", "peek-more");
    note.textContent = nothing;
    card.append(note);
    return;
  }
  const name = el("span", "word-class-name");
  name.textContent = peek.pos;
  head.append(name);
  card.append(meanings(peek.meanings, null));
  if (peek.more > 0) {
    const more = el("p", "peek-more");
    more.textContent = `+ ${peek.more} more · tap the word for all`;
    card.append(more);
  }
}

/** Numbered meanings: labels first ("archaic"), then the gloss with its links
 *  as buttons (or plain words when `open` is null: the peek can't be tapped),
 *  then an example of use, if it has one. */
function meanings(list: readonly MeaningView[], open: OpenWord | null): HTMLOListElement {
  const ol = el("ol", "meanings");
  for (const m of list) {
    const li = el("li", "meaning");
    li.value = m.n;
    m.labels.forEach((text, i) => {
      const label = el("span", "label");
      label.textContent = text;
      li.append(label, i < m.labels.length - 1 ? " · " : " "); // each label its own: "archaic · in old ledgers"
    });
    const gloss = el("span", "gloss");
    for (const part of glossParts(m.gloss, m.links)) {
      if (typeof part === "string" || !open) {
        gloss.append(typeof part === "string" ? part : part.text);
        continue;
      }
      const link = el("button", "word-link");
      link.type = "button";
      link.textContent = part.text;
      if (part.word !== part.text) link.title = part.word;
      link.addEventListener("click", () => open(part.word));
      gloss.append(link);
    }
    li.append(gloss);
    if (m.example) {
      const example = el("p", "example");
      example.textContent = m.example;
      li.append(example);
    }
    ol.append(li);
  }
  return ol;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
