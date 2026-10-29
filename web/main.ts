import "@fontsource-variable/literata/opsz.css";
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "./styles.css";

import type { Suggestion } from "../src/complete";
import { normalize } from "../src/normalize";
import { sourcePageUrl } from "../src/attribution";
import type { Counts, FromWorker, ToWorker } from "./protocol";
import { ResultsList } from "./results-list";
import { OffsetSlider } from "./offset-slider";
import { ScrollerGestures } from "./scroller-gestures";
import { setUpNativeShell } from "./native";
import { EXAMPLES, exampleLabel } from "./examples";
import { FILTERS, filterKey, type FilterInfo } from "../src/filters";
import { loadFilters, saveFilter } from "./saved-filters";
import { FiltersPanel } from "./filters-panel";
import { entryView, peekView } from "../src/entry-view";
import type { Definition } from "../src/definitions";
import { renderEntry, type EntryContent } from "./entry-page";
import { fitClamps } from "./clamp";
import { Peek } from "./peek";
import { pulse } from "./haptics";
import { Trail } from "../src/trail";
import { Swipes, type SwipeDirection } from "./swipe";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>("q");
const status = $("status");
const summary = $("summary");
const intro = $("intro");
const frame = $("frame");
const scroller = $("scroller");
const entry = $("entry");
const hint = $("hint");
const settings = $<HTMLDialogElement>("settings");
const switches = $("switches");
const panels = [settings, $<HTMLDialogElement>("filters")];

const worker = new Worker(new URL("./search-worker.ts", import.meta.url), { type: "module" });
const send = (message: ToWorker) => worker.postMessage(message);

let seq = 0; // id of the latest search; older answers are ignored
let ready = false;
let query = ""; // the normalized query on screen
let counts: Counts | null = null; // for `query`
let seeking = -1; // the position a seek is on its way to

const list = new ResultsList(scroller, $("results"), {
  needRows: (from, to) => send({ type: "rows", seq, from, to }),
  choose: (s) => showEntry(s),
});

const slider = new OffsetSlider(frame, {
  state: () =>
    query && counts && counts.occurrences > 0
      ? { query, byOffset: counts.byOffset, complete: counts.total !== null }
      : null,
  change: (value) => seek(value),
  used: () => {
    hint.hidden = true;
    remember(HINT_SEEN);
  },
});

// Taps, holds and drags on the list (scroller-gestures.ts): a tap opens a word,
// unless it's a finger putting the keyboard away; a hold on a blank spot opens
// the slider.
new ScrollerGestures(scroller, {
  typing: () => document.activeElement === input,
  dismissKeyboard: () => input.blur(),
  holdStart: (x) => slider.open(x),
  holdMove: (x) => slider.slideTo(x),
  holdEnd: () => slider.close(),
  peek: (target) => peekAt(target),
  unpeek: () => {
    peekSeq++; // an answer still on its way is for a peek that's over
    peek.hide();
  },
});

// Which words to leave out (src/filters.ts), as saved on this device. Settings
// draws a switch per switch filter; the Filters panel holds the ranges.
const filters = loadFilters();
send({ type: "settings", filters });

/** A filter changed: remember it, and show the list again under it. */
function setFilter(id: string, value: (typeof filters)[string]) {
  filters[id] = value;
  saveFilter(id, value);
  send({ type: "settings", filters });
  counts = null; // counted under the old filters
  if (query) search(input.value);
}

for (const f of FILTERS) {
  if (f.kind !== "switch") continue;
  const row = document.createElement("label");
  row.className = "setting";
  row.dataset.filter = f.id;
  row.innerHTML = `<span class="setting-text"><span class="setting-name"></span><span class="setting-help"></span></span>
    <input class="switch" type="checkbox" role="switch" />`;
  row.querySelector(".setting-name")!.textContent = f.label;
  const help = row.querySelector<HTMLElement>(".setting-help")!;
  help.textContent = f.help;
  help.id = `${f.id}-help`;
  const toggle = row.querySelector<HTMLInputElement>("input")!;
  toggle.id = f.id;
  toggle.setAttribute("aria-describedby", help.id);
  toggle.checked = filters[f.id] === true;
  toggle.addEventListener("change", () => setFilter(f.id, toggle.checked));
  switches.append(row);
}

// The ranges (word length) are wheels in the Filters panel, under the cog.
const filtersPanel = new FiltersPanel($<HTMLDialogElement>("filters"), $("ranges"), $<HTMLButtonElement>("filters-open"), filters, setFilter);

/** Offer only the filters this index has the data for. */
function offerFilters(available: FilterInfo[]) {
  const ids = new Set(available.map((f) => f.id));
  for (const row of switches.querySelectorAll<HTMLElement>("[data-filter]")) row.hidden = !ids.has(row.dataset.filter!);
  filtersPanel.offer(available);
}

// The word list file: ?index= overrides it (tests use a small one), but only
// with a file of the app's own: a link mustn't make the app fetch from elsewhere.
const asked = new URL(new URLSearchParams(location.search).get("index") ?? "headwords.bin", location.href);
const indexUrl = asked.origin === location.origin ? asked : new URL("headwords.bin", location.href);
send({ type: "load", url: indexUrl.href, definitions: indexUrl.href.replace(/\.bin$/, ".definitions.bin") });

// Questions for the worker that get one answer each, matched up by number.
let questions = 0;
const answers = new Map<number, (answer: FromWorker) => void>();
function ask(question: { type: "definitions"; id: number } | { type: "word"; text: string }): Promise<FromWorker> {
  const n = ++questions;
  send({ ...question, ask: n });
  return new Promise((resolve) => answers.set(n, resolve));
}
const definitionsOf = (id: number) =>
  ask({ type: "definitions", id }).then((a): Definition[] | null => (a.type === "definitions" ? a.definitions : null));
const wordNamed = (text: string) =>
  ask({ type: "word", text }).then((a): Suggestion | null => (a.type === "word" ? a.suggestion : null));
const safe = () => filters["safe-search"] === true;

worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
  switch (data.type) {
    case "ready":
      ready = true;
      status.textContent = `${data.words.toLocaleString()} words`;
      offerFilters(data.filters);
      if (normalize(input.value)) summary.textContent = "Searching…";
      break;
    case "failed":
      status.textContent = "Word list unavailable";
      summary.textContent = `Couldn’t load the word list (${data.message}). Reload the app to try again.`;
      break;
    case "rows":
      if (data.seq !== seq) return; // an answer to an older search
      counts = mergeCounts(counts, data.counts);
      list.receive(data.from, data.items, data.known, data.complete);
      if (data.seek && data.seek.offset === seeking) {
        list.scrollToRow(data.seek.row);
        seeking = -1;
      }
      describe();
      break;
    case "definitions":
    case "word":
      answers.get(data.ask)?.(data);
      answers.delete(data.ask);
      break;
    case "counts":
      if (data.query !== query || data.counts.filters !== filterKey(filters)) return;
      counts = data.counts;
      list.grow(sum(counts.byOffset), counts.total !== null);
      describe();
      break;
  }
};

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Keep whichever counts know more: background counting can finish before a page. */
function mergeCounts(old: Counts | null, next: Counts): Counts {
  if (!old || old.occurrences !== next.occurrences || old.starts !== next.starts) return next;
  return old.total !== null || old.byOffset.length > next.byOffset.length ? old : next;
}

input.addEventListener("input", () => search(input.value));

function search(text: string) {
  leaveEntry();
  const next = normalize(text);
  if (next !== query) {
    counts = null;
    trail.clear(); // the words followed from the old results
  }
  query = next;
  seeking = -1;
  seq++;
  if (!query) {
    frame.hidden = true;
    intro.hidden = false;
    hint.hidden = true;
    summary.textContent = "";
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    return;
  }
  intro.hidden = true;
  frame.hidden = false;
  input.setAttribute("aria-expanded", "true");
  input.removeAttribute("aria-activedescendant");
  if (!ready) summary.textContent = "Loading the word list…";
  list.reset(query);
  send({ type: "search", seq, query: text });
}

/** Scroll to where words with `offset` letters before the match begin. The
 *  whole list stays: scroll up for fewer letters, down for more. */
function seek(offset: number) {
  if (!query || offset < 0) return;
  if (counts && offset <= counts.byOffset.length) {
    // Every position before it is counted: the row is known here.
    seeking = -1;
    list.scrollToRow(sum(counts.byOffset.slice(0, offset)));
  } else {
    seeking = offset;
    send({ type: "seek", seq, offset });
  }
}

const fmt = (n: number) => n.toLocaleString();
/** Two significant digits: 43,232 -> "43,000". */
const roughly = (n: number) => {
  const unit = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return fmt(Math.round(n / unit) * unit);
};

function describe() {
  if (!counts) return;
  const q = `“${query}”`;
  if (counts.occurrences === 0) {
    summary.textContent = `No word contains ${q}. Try a shorter piece.`;
    hint.hidden = true;
    return;
  }
  if (counts.total === 0) {
    summary.textContent = `Settings or filters hide every word with ${q}.`;
    hint.hidden = true;
    return;
  }
  // Unknown counts: the occurrences are close to the total without filters,
  // but filters can leave out most of them, so then just wait for the count.
  const total =
    counts.total !== null ? fmt(counts.total) : counts.filtered ? "…" : `about ${roughly(counts.occurrences)}`;
  const { starts, ends } = counts;
  summary.textContent =
    `${fmt(starts)} ${starts === 1 ? "starts" : "start"} with ${q} · ` +
    `${ends === null ? "…" : fmt(ends)} ${ends === 1 ? "ends" : "end"} with it · ${total} in all`;
  hint.hidden = seen(HINT_SEEN);
}

input.addEventListener("keydown", (event) => {
  if (frame.hidden) return;
  if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    // The keyboard's way to move the position slider: from the position at
    // the top of the list to the next or previous one.
    event.preventDefault();
    const here = list.topOffset() ?? 0;
    const last = counts ? counts.byOffset.length - (counts.total !== null ? 1 : 0) : here + 1;
    seek(Math.min(last, Math.max(0, here + (event.key === "ArrowRight" ? 1 : -1))));
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const id = list.move(event.key === "ArrowDown" ? 1 : -1);
    if (id) input.setAttribute("aria-activedescendant", id);
  } else if (event.key === "Enter") {
    const s = list.current();
    if (s) showEntry(s);
  } else if (event.key === "Escape") {
    input.value = "";
    search("");
  }
});

// Where Back returns to from an open word: the search text, its summary and scroll position.
let returnTo: { text: string; summary: string; scrollTop: number } | null = null;
let entrySeq = 0; // the entry on screen; older answers are dropped

// The words followed since leaving the results (src/trail.ts). One history
// step stands for all of them, so Back (browser or Android) goes straight to
// the results; a swipe steps along them one word at a time, and a swipe
// forward from the results takes them up again.
const trail = new Trail<Suggestion>();

/** A word tapped in the results: a new trail. */
function showEntry(s: Suggestion) {
  trail.start(s);
  leaveResults();
  drawEntry(s, "forward");
}

/** A word a definition links to: open it, if the index has it. */
function openWord(text: string) {
  void wordNamed(text).then((s) => {
    if (!s) return;
    trail.follow(s);
    drawEntry(s, "forward");
  });
}

/** From the results onto the trail: remember them, and add the one history step back to them. */
function leaveResults() {
  rememberResults();
  history.pushState({ trail: true }, "");
}

function rememberResults() {
  if (!frame.hidden) returnTo = { text: input.value, summary: summary.textContent ?? "", scrollTop: scroller.scrollTop };
}

/** A swipe (or ←/→ on a word's page): one word back or forward. */
function step(direction: SwipeDirection) {
  if (panels.some((panel) => panel.open)) return;
  if (direction === "back") {
    if (!trail.canBack) return;
    if (trail.depth === 1) return history.back(); // to the results, by the history step (popstate shows them)
    drawEntry(trail.back()!, "back");
  } else {
    if (!trail.canForward) return;
    if (trail.depth === 0) leaveResults();
    drawEntry(trail.forward()!, "forward");
  }
}

new Swipes(document, step);
document.addEventListener("keydown", (event) => {
  const keys: Record<string, SwipeDirection> = { ArrowLeft: "back", ArrowRight: "forward" };
  if (entry.hidden || !keys[event.key] || event.target === input || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  step(keys[event.key]);
});

/** Past this wait, a word's page shows that its definitions are loading
 *  (the file is still on its way) rather than nothing happening. */
const SLOW_MS = 300;

/** Show a word's page once its definitions are in, all of it at once, so
 *  nothing appears and then moves (top to bottom, in reading order). It
 *  turns in from the side it came from: forward from the right, back from the left. */
function drawEntry(s: Suggestion, from: SwipeDirection) {
  const seq = ++entrySeq;
  const slow = setTimeout(() => seq === entrySeq && paintEntry(seq, s, "loading", from), SLOW_MS);
  void definitionsOf(s.id).then((definitions) => {
    clearTimeout(slow);
    if (seq !== entrySeq) return;
    paintEntry(seq, s, definitions ? entryView(definitions, { safe: safe() }) : null, from);
  });
}

const source = $<HTMLAnchorElement>("source");
const WIKTIONARY = source.getAttribute("href")!; // as written, not normalized

let painted = 0; // the entry (by entrySeq) the page shows

function paintEntry(seq: number, s: Suggestion, content: EntryContent, from: SwipeDirection) {
  const parts = { word: $("entry-word"), forms: $("entry-forms"), body: $("entry-body"), note: $("entry-note") };
  renderEntry(parts, s, content, openWord);
  source.href = sourcePageUrl({ headword: s.display, source: "Wiktionary", license: "CC-BY-SA-4.0" }) ?? WIKTIONARY;
  if (painted === seq) return fitClamps(parts.body); // its definitions, after "loading": the rest is in place
  painted = seq;
  input.value = s.display;
  frame.hidden = true;
  intro.hidden = true;
  hint.hidden = true; // the slider's tip belongs to the results
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  summary.textContent = "";
  entry.hidden = false;
  entry.dataset.from = from;
  entry.classList.remove("turning");
  void entry.offsetWidth; // restart the animation
  entry.classList.add("turning");
  fitClamps(parts.body); // laid out now, before the screen is painted
  window.scrollTo(0, 0);
}

// Folded text that fitted may not after the page narrows (a phone turned), or the reverse.
new ResizeObserver(() => fitClamps($("entry-body"))).observe($("entry-body"));

/** Back to the results or the start screen: drop the open word, and any still on its way. */
function leaveEntry() {
  entrySeq++;
  entry.hidden = true;
  source.href = WIKTIONARY;
}

// The peek: hold a word in the results to see its first meanings.
const peek = new Peek($("peek"));
let peekSeq = 0;
function peekAt(target: Element) {
  const s = list.wordAt(target);
  const row = target.closest("li.word");
  if (!s || !row) return;
  const seq = ++peekSeq;
  pulse();
  void definitionsOf(s.id).then((definitions) => {
    if (seq !== peekSeq) return; // let go already
    const view = definitions ? entryView(definitions, { safe: safe() }) : null;
    const why = view ? "Its meanings are hidden by safe search." : "No definition for this word in the app yet.";
    peek.show(row, s.display, view ? peekView(view) : null, why);
  });
}

window.addEventListener("popstate", (event) => {
  if ((event.state as { trail?: boolean } | null)?.trail) {
    // The browser's Forward, back onto the trail: its first word.
    if (trail.depth === 0 && trail.canForward) {
      rememberResults();
      drawEntry(trail.forward()!, "forward");
    }
    return;
  }
  trail.home(); // Back: straight to the results, the words kept for a swipe forward
  if (entry.hidden) return;
  leaveEntry();
  if (!returnTo) return search(input.value);
  // The results are still in the list; show them again where they were.
  input.value = returnTo.text;
  summary.textContent = returnTo.summary;
  frame.hidden = false;
  scroller.scrollTop = returnTo.scrollTop; // hiding the list reset it
  input.setAttribute("aria-expanded", "true");
});

void setUpNativeShell({
  closePanel: () => {
    const open = panels.find((panel) => panel.open);
    open?.close();
    return !!open;
  },
  clearSearch: () => {
    if (!input.value) return false;
    input.value = "";
    search("");
    return true;
  },
});

// Settings: the cog opens them; the funnel opens Filters. Done, Escape, Back
// or a tap outside closes either.
$("settings-open").addEventListener("click", () => settings.showModal());
for (const panel of panels) {
  panel.addEventListener("click", (event) => {
    if (event.target === panel) panel.close(); // the backdrop, outside the panel
  });
}

// Example fragments fill the start screen; tapping one searches for it.
const examples = $("examples");
for (const [fragment, where] of EXAMPLES) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.query = fragment;
  button.textContent = exampleLabel(fragment, where);
  const item = document.createElement("li");
  item.append(button);
  examples.append(item);
}
examples.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-query]");
  if (!button) return;
  input.value = button.dataset.query ?? "";
  // Leave the keyboard closed, so the results have the whole screen to explore.
  input.blur();
  search(input.value);
});

// Browser storage for settings and one-time hints. It can be missing or
// blocked; then settings fall back to their defaults and hints show again.
const HINT_SEEN = "dictionarius.slider-hint-seen";
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not stored; harmless
  }
}
const seen = (key: string) => read(key) === "1";
const remember = (key: string) => write(key, "1");

// The seam sits a fixed share of the row width from the left edge.
const placeSeam = () => {
  const pad = parseFloat(getComputedStyle(frame).getPropertyValue("--pad")) * 16 || 20;
  const width = (frame.clientWidth || document.documentElement.clientWidth) - 2 * pad;
  const seam = Math.round(Math.min(220, Math.max(88, width * 0.34)));
  document.documentElement.style.setProperty("--seam-x", `${seam}px`);
};
new ResizeObserver(placeSeam).observe(document.body);
placeSeam();
