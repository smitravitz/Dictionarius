/**
 * The results list: one list of every match (the exact match, then words by
 * how many letters come before the typed text), loaded where you look. Only
 * rows near the viewport exist in the DOM, and only pages of rows near the
 * viewport are fetched, so jumping deep into a long list is instant and you
 * can still scroll all the way back up.
 *
 * Every row is aligned on the typed fragment: text before it sits left of the
 * seam, the fragment and the rest to the right. A row too long for the screen
 * scrolls sideways, starting on the seam.
 *
 * Browsers cap how tall an element can be (about 17 million pixels in
 * Firefox). A list taller than MAX_HEIGHT is drawn on a shorter scroll range
 * and mapped onto it: each pixel scrolled moves the rows `scale` pixels.
 */
import type { Suggestion } from "../src/complete";
import { splitOnFragment } from "../src/highlight";
import { PAGE_SIZE } from "./protocol";

export const ROW_HEIGHT = 52;
const OVERSCAN = 8; // rows rendered beyond each edge of the viewport
const PREFETCH_ROWS = 25; // ask for the next page when this close to the end of what's known
const MAX_HEIGHT = 8_000_000;

export interface ResultsListEvents {
  /** Fetch rows [from, to). */
  needRows(from: number, to: number): void;
  choose(s: Suggestion): void;
}

export class ResultsList {
  private rows = new Map<number, Suggestion>();
  private length = 0; // rows known to exist
  private complete = false; // `length` is final
  private query = "";
  private readonly requested = new Set<number>(); // pages asked for
  private active = -1; // index of the keyboard-highlighted row
  private readonly rendered = new Map<number, HTMLElement>();
  private readonly foot: HTMLElement;
  private frame = 0;

  constructor(
    private readonly scroller: HTMLElement,
    private readonly list: HTMLElement,
    private readonly events: ResultsListEvents,
  ) {
    this.foot = document.createElement("li");
    this.foot.className = "foot";
    this.foot.setAttribute("role", "presentation");
    scroller.addEventListener("scroll", () => this.schedule(), { passive: true });
    new ResizeObserver(() => {
      this.alignRows([...this.rendered.values()]); // the seam may have moved
      this.schedule();
    }).observe(scroller);
    list.addEventListener("click", (event) => {
      const li = (event.target as Element).closest<HTMLElement>("li[data-row]");
      const s = li ? this.rows.get(Number(li.dataset.row)) : undefined;
      if (s) this.events.choose(s);
    });
  }

  /** Start showing results for a new search (its first page is on its way). */
  reset(query: string) {
    this.rows.clear();
    this.length = 0;
    this.complete = false;
    this.requested.clear();
    this.requested.add(0); // the search itself returns the first page
    this.query = query;
    this.active = -1;
    for (const el of this.rendered.values()) el.remove();
    this.rendered.clear();
    this.scroller.scrollTop = 0;
    this.render();
  }

  /** Rows arrived, starting at row `from`; the list is at least `known` long
   *  (exactly, when `complete`). */
  receive(from: number, items: Suggestion[], known: number, complete: boolean) {
    items.forEach((s, i) => this.rows.set(from + i, s));
    this.grow(Math.max(known, from + items.length), complete);
    // Rows drawn as placeholders can show their words now.
    for (let i = from; i < from + items.length; i++) {
      const el = this.rendered.get(i);
      if (el?.classList.contains("pending")) {
        el.remove();
        this.rendered.delete(i);
      }
    }
    this.render();
  }

  /** The list turned out at least `known` rows long (exactly, when `complete`). */
  grow(known: number, complete: boolean) {
    if (known > this.length) this.length = known;
    if (complete) {
      this.complete = true;
      this.length = known;
    }
    this.schedule();
  }

  /** Scroll so row `i` is at the top. */
  scrollToRow(i: number) {
    this.scroller.scrollTop = (Math.max(0, i) * ROW_HEIGHT) / this.scale();
    this.render();
  }

  /** Position (letters before the match) of the row at the top, if loaded. */
  topOffset(): number | null {
    const i = Math.floor(this.virtualTop() / ROW_HEIGHT);
    return this.rows.get(i)?.offset ?? null;
  }

  /** Move the keyboard highlight by one row; returns the active row's id. */
  move(delta: 1 | -1): string | null {
    const i = Math.min(Math.max(this.active + delta, 0), this.length - 1);
    if (i < 0) return null;
    this.rendered.get(this.active)?.setAttribute("aria-selected", "false");
    this.active = i;
    this.rendered.get(i)?.setAttribute("aria-selected", "true");
    const top = i * ROW_HEIGHT;
    const viewTop = this.virtualTop();
    const { clientHeight } = this.scroller;
    if (top < viewTop) this.scrollToRow(i);
    else if (top + ROW_HEIGHT > viewTop + clientHeight) this.scrollToRow(i + 1 - clientHeight / ROW_HEIGHT);
    this.render();
    return `opt-${i}`;
  }

  /** The highlighted word, or the first one if none is highlighted. */
  /** The word on the row holding `element`, or null. */
  wordAt(element: Element): Suggestion | null {
    const row = element.closest<HTMLElement>("li.word");
    return row ? (this.rows.get(Number(row.dataset.row)) ?? null) : null;
  }

  current(): Suggestion | null {
    return this.rows.get(Math.max(this.active, 0)) ?? null;
  }

  /** Rows (plus the footer) in pixels, and the scroll range drawn for them. */
  private contentHeight() {
    return (this.length + 1) * ROW_HEIGHT;
  }

  /** Content pixels per scrolled pixel: 1 unless the list is taller than MAX_HEIGHT. */
  private scale(): number {
    const content = this.contentHeight();
    if (content <= MAX_HEIGHT) return 1;
    const view = this.scroller.clientHeight;
    return (content - view) / (MAX_HEIGHT - view);
  }

  /** The content pixel at the top of the viewport. */
  private virtualTop(): number {
    return this.scroller.scrollTop * this.scale();
  }

  private schedule() {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.render());
  }

  private render() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const { scrollTop, clientHeight } = this.scroller;
    const viewTop = this.virtualTop();
    // Where content pixel y appears inside the list element.
    const at = (y: number) => y - viewTop + scrollTop;
    const first = Math.max(0, Math.floor(viewTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(this.length, Math.ceil((viewTop + clientHeight) / ROW_HEIGHT) + OVERSCAN);

    for (const [i, el] of this.rendered) {
      if (i < first || i >= last) {
        el.remove();
        this.rendered.delete(i);
      }
    }
    const added: HTMLElement[] = [];
    for (let i = first; i < last; i++) {
      let el = this.rendered.get(i);
      if (!el) {
        el = this.build(i);
        this.list.append(el);
        this.rendered.set(i, el);
        if (!el.classList.contains("pending")) added.push(el);
      }
      el.style.transform = `translateY(${at(i * ROW_HEIGHT)}px)`;
    }
    this.alignRows(added);

    // Fetch the pages under the viewport that haven't been asked for.
    for (let page = Math.floor(first / PAGE_SIZE); page * PAGE_SIZE < last; page++) this.request(page);
    // Near the end of what's known: ask for the next page, which also finds
    // out whether the list goes on.
    if (!this.complete && last + PREFETCH_ROWS >= this.length) this.request(Math.floor(this.length / PAGE_SIZE));

    const count = this.length;
    this.foot.textContent = !this.complete ? "Loading more…" : count > 0 ? `That’s all ${count.toLocaleString()}.` : "";
    this.foot.style.transform = `translateY(${at(count * ROW_HEIGHT)}px)`;
    if (!this.foot.isConnected) this.list.append(this.foot);
    this.list.style.height = `${Math.min(this.contentHeight(), MAX_HEIGHT)}px`;
  }

  private request(page: number) {
    if (this.requested.has(page)) return;
    this.requested.add(page);
    this.events.needRows(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }

  private build(i: number): HTMLElement {
    const s = this.rows.get(i);
    const li = document.createElement("li");
    li.dataset.row = String(i);
    li.id = `opt-${i}`;
    li.setAttribute("aria-selected", String(i === this.active));
    li.setAttribute("aria-posinset", String(i + 1));
    li.setAttribute("aria-setsize", this.complete ? String(this.length) : "-1");
    if (!s) {
      // Not loaded yet: an empty row that fills in when its page arrives.
      li.className = "word pending";
      li.setAttribute("role", "option");
      li.setAttribute("aria-label", "Loading");
      li.setAttribute("aria-busy", "true");
      return li;
    }
    li.className = "word";
    li.setAttribute("role", "option");
    li.setAttribute("aria-label", s.display);

    const split = splitOnFragment(s.display, this.query) ?? { before: "", match: "", after: s.display };
    const match = document.createElement("mark");
    match.className = "frag";
    match.textContent = split.match;
    const line = span("line", "");
    line.append(span("before", split.before), match, span("after", split.after));
    const track = span("track", "");
    track.append(line);
    li.append(track);
    return li;
  }

  /** Scroll rows sideways so their fragment sits on the seam. Text longer than
   *  the space left of the seam would otherwise push the fragment right. */
  private alignRows(rows: HTMLElement[]) {
    rows = rows.filter((li) => li.querySelector(".before"));
    if (rows.length === 0) return;
    const seam = parseFloat(getComputedStyle(this.list).getPropertyValue("--seam-x")) || 0;
    // Measure every row, then widen and scroll them, so layout runs only twice.
    const shifts = rows.map((li) =>
      Math.max(0, (li.querySelector(".before") as HTMLElement).getBoundingClientRect().width - seam),
    );
    // Room to scroll that far even when the rest of the word is short.
    rows.forEach((li, i) => {
      (li.querySelector(".line") as HTMLElement).style.minWidth = `calc(100% + ${shifts[i]}px)`;
    });
    rows.forEach((li, i) => {
      (li.firstElementChild as HTMLElement).scrollLeft = shifts[i];
    });
  }
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement("span");
  if (className) el.className = className;
  el.textContent = text;
  return el;
}
