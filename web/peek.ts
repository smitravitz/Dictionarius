/**
 * The peek: hold a word in the results and a card with its first meanings
 * appears beside the row, above it when there's room, else below; it goes
 * when the finger lifts. What a held word means is decided in
 * scroller-gestures.ts; what the card says, in entry-page.ts.
 */
import type { PeekView } from "../src/entry-view";
import { renderPeek } from "./entry-page";

const GAP = 8; // px between the card and the row, and the card and the screen's edge

export class Peek {
  constructor(private readonly card: HTMLElement) {}

  /** Show `peek` for `word` beside `row`; `nothing` says why there's no definition to show. */
  show(row: Element, word: string, peek: PeekView | null, nothing: string) {
    renderPeek(this.card, word, peek, nothing);
    this.card.style.visibility = "hidden"; // measure before placing
    this.card.hidden = false;
    const rect = row.getBoundingClientRect();
    const height = this.card.offsetHeight;
    const above = rect.top - GAP - height;
    const top = above >= GAP ? above : Math.min(rect.bottom + GAP, window.innerHeight - GAP - height);
    this.card.style.top = `${Math.max(GAP, top)}px`;
    this.card.style.visibility = "";
  }

  hide() {
    this.card.hidden = true;
  }
}
