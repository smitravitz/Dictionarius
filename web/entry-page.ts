/**
 * Draws a word's definitions (src/entry-view.ts shapes them): on the entry
 * page, every word class under its origin, with numbered meanings whose
 * linked words open their own entries, as on Wiktionary; in the peek card,
 * the first meanings only.
 */
import { glossParts, type EntryView, type MeaningView, type PeekView } from "../src/entry-view";

/** Opens the word a link names. */
export type OpenWord = (word: string) => void;

/** Fill the entry page's body. `headword` is the word as the page titles it:
 *  a word class under another written form names that form. */
export function renderEntry(body: HTMLElement, note: HTMLElement, view: EntryView | null, headword: string, open: OpenWord) {
  body.replaceChildren();
  if (view?.ipa.length) {
    const ipa = el("p", "entry-ipa");
    ipa.textContent = view.ipa.join(" · ");
    body.append(ipa);
  }
  for (const c of view?.classes ?? []) {
    const section = el("section", "word-class");
    if (c.etymology) {
      const origin = el("p", "etymology");
      origin.textContent = c.etymology;
      section.append(origin);
    }
    const head = el("h3", "word-class-head");
    const form = el("span", "word-class-form");
    form.textContent = c.form === headword ? "" : c.form;
    const name = el("span", "word-class-name");
    name.textContent = c.pos;
    head.append(form, name);
    section.append(head, meanings(c.meanings, open));
    body.append(section);
  }
  note.hidden = false;
  if (!view) note.textContent = "No definition for this word in the app yet.";
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
 *  as buttons (or plain words when `open` is null: the peek can't be tapped). */
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
    for (const part of glossParts(m.gloss, m.links)) {
      if (typeof part === "string" || !open) {
        li.append(typeof part === "string" ? part : part.text);
        continue;
      }
      const link = el("button", "word-link");
      link.type = "button";
      link.textContent = part.text;
      if (part.word !== part.text) link.title = part.word;
      link.addEventListener("click", () => open(part.word));
      li.append(link);
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
