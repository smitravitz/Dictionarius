/**
 * The results dropdown: a virtual list (only rows near the viewport exist in
 * the DOM) that asks for the next page before the user reaches the end.
 * Every row is aligned on the typed fragment: text before it sits left of the
 * seam, the fragment and the rest to the right. A word that starts with the
 * fragment has nothing left of the seam, so the geometry shows the match type.
 */
import type { Suggestion } from "../src/complete";
import { splitOnFragment } from "../src/highlight";

export const ROW_HEIGHT = 52;
const OVERSCAN = 8; // rows rendered beyond each edge of the viewport
const PREFETCH_ROWS = 25; // ask for more when this close to the end

export interface ResultsListEvents {
  needMore(): void;
  choose(s: Suggestion): void;
}

export class ResultsList {
  private rows: Suggestion[] = [];
  private query = "";
  private done = true;
  private waiting = false; // a page has been requested and not yet received
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
    new ResizeObserver(() => this.schedule()).observe(scroller);
    list.addEventListener("click", (event) => {
      const li = (event.target as Element).closest<HTMLElement>("li[data-row]");
      const s = li ? this.rows[Number(li.dataset.row)] : undefined;
      if (s) this.events.choose(s);
    });
    enableDragScroll(scroller);
  }

  /** Start showing results for a new search (the first page is on its way). */
  reset(query: string) {
    this.rows = [];
    this.query = query;
    this.done = false;
    this.waiting = true;
    this.active = -1;
    for (const el of this.rendered.values()) el.remove();
    this.rendered.clear();
    this.scroller.scrollTop = 0;
    this.render();
  }

  /** Add a page of results. */
  append(items: Suggestion[], done: boolean) {
    this.rows.push(...items);
    this.done = done;
    this.waiting = false;
    if (done) {
      for (const el of this.rendered.values()) el.setAttribute("aria-setsize", String(this.rows.length));
    }
    this.render();
  }

  /** Move the keyboard highlight by one row; returns the active row's id. */
  move(delta: 1 | -1): string | null {
    const i = Math.min(Math.max(this.active + delta, 0), this.rows.length - 1);
    if (i < 0) return null;
    this.rendered.get(this.active)?.setAttribute("aria-selected", "false");
    this.active = i;
    this.rendered.get(i)?.setAttribute("aria-selected", "true");
    const top = i * ROW_HEIGHT;
    const { scrollTop, clientHeight } = this.scroller;
    if (top < scrollTop) this.scroller.scrollTop = top;
    else if (top + ROW_HEIGHT > scrollTop + clientHeight) this.scroller.scrollTop = top + ROW_HEIGHT - clientHeight;
    this.render();
    return `opt-${i}`;
  }

  /** The highlighted word, or the first one if none is highlighted. */
  current(): Suggestion | null {
    return this.rows[Math.max(this.active, 0)] ?? null;
  }

  private schedule() {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.render());
  }

  private render() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const { scrollTop, clientHeight } = this.scroller;
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(this.rows.length, Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT) + OVERSCAN);

    for (const [i, el] of this.rendered) {
      if (i < first || i >= last) {
        el.remove();
        this.rendered.delete(i);
      }
    }
    for (let i = first; i < last; i++) {
      if (!this.rendered.has(i)) {
        const el = this.build(i);
        this.list.append(el);
        this.rendered.set(i, el);
      }
    }

    const count = this.rows.length;
    this.foot.textContent = !this.done ? "Loading more…" : count > 0 ? `That’s all ${count.toLocaleString()}.` : "";
    this.foot.style.transform = `translateY(${count * ROW_HEIGHT}px)`;
    if (!this.foot.isConnected) this.list.append(this.foot);
    this.list.style.height = `${(count + 1) * ROW_HEIGHT}px`;

    // Ask for the next page early, and keep asking while the list is shorter
    // than the screen (a page can come back short).
    const nearEnd = scrollTop + clientHeight > (count - PREFETCH_ROWS) * ROW_HEIGHT;
    if (nearEnd && !this.done && !this.waiting) {
      this.waiting = true;
      this.events.needMore();
    }
  }

  private build(i: number): HTMLElement {
    const s = this.rows[i];
    const li = document.createElement("li");
    li.className = "word";
    li.style.transform = `translateY(${i * ROW_HEIGHT}px)`;
    li.dataset.row = String(i);
    li.id = `opt-${i}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === this.active));
    li.setAttribute("aria-posinset", String(i + 1));
    li.setAttribute("aria-setsize", this.done ? String(this.rows.length) : "-1");
    li.setAttribute("aria-label", s.display);

    const split = splitOnFragment(s.display, this.query) ?? { before: "", match: "", after: s.display };
    const before = span("before", "");
    before.append(span("", split.before));
    const match = document.createElement("mark");
    match.className = "frag";
    match.textContent = split.match;
    li.append(before, match, span("after", split.after));
    return li;
  }
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement("span");
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

/**
 * Drag-to-scroll for mice, with momentum on release. Touch keeps the browser's
 * native scrolling (already a drag, with the platform's own momentum). A drag
 * longer than a few pixels doesn't count as a click on the row under it.
 */
function enableDragScroll(el: HTMLElement) {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let pointerId = -1;
  let startY = 0;
  let startTop = 0;
  let dragging = false;
  let suppressClick = false;
  let samples: { t: number; y: number }[] = [];
  let glide = 0;

  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    cancelAnimationFrame(glide);
    pointerId = e.pointerId;
    startY = e.clientY;
    startTop = el.scrollTop;
    dragging = false;
    samples = [{ t: e.timeStamp, y: e.clientY }];
  });

  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointerId) return;
    const dy = e.clientY - startY;
    if (!dragging && Math.abs(dy) > 6) {
      dragging = true;
      el.setPointerCapture(pointerId);
      el.classList.add("dragging");
    }
    if (!dragging) return;
    el.scrollTop = startTop - dy;
    samples.push({ t: e.timeStamp, y: e.clientY });
    if (samples.length > 6) samples.shift();
  });

  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = -1;
    if (!dragging) return;
    dragging = false;
    el.classList.remove("dragging");
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);

    const first = samples[0];
    const last = samples[samples.length - 1];
    const stillFor = e.timeStamp - last.t;
    let velocity = last.t > first.t && stillFor < 80 ? (last.y - first.y) / (last.t - first.t) : 0;
    if (reduceMotion.matches || velocity === 0) return;
    let previous = performance.now();
    const step = (now: number) => {
      const dt = now - previous;
      previous = now;
      el.scrollTop -= velocity * dt;
      velocity *= Math.pow(0.95, dt / 16);
      if (Math.abs(velocity) > 0.02) glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener(
    "click",
    (e) => {
      if (!suppressClick) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}
