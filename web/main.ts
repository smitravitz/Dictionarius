import "@fontsource-variable/literata/opsz.css";
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "./styles.css";

import type { Suggestion } from "../src/complete";
import { normalize } from "../src/normalize";
import { sourcePageUrl } from "../src/attribution";
import type { Counts, FromDataWorker, FromWorker, ToDataWorker, ToWorker } from "./protocol";
import { ResultsList } from "./results-list";
import { OffsetSlider } from "./offset-slider";
import { ScrollerGestures } from "./scroller-gestures";
import { setUpNativeShell } from "./native";
import { LANES, PIECES, lanesOf, tileWeight } from "./examples";
import { FILTERS, describeRange, filterKey, type FilterInfo, type Range } from "../src/filters";
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
import { guardEdges } from "./edge-gestures";
import { setUpLoader } from "./loader";
import { CONTROLS, Tour } from "./guide";
import { Coach, type Screen } from "./coach";
import { tourShows } from "./tour-shows";
import { Hands } from "./hands";
import { placeToKeep, placeToRestore, type Place } from "./place";
import { Capacitor } from "@capacitor/core";
import { AS_APP } from "./shell";
import { offerInstall } from "./install";
import { setUpTheme } from "./theme";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>("q");
const status = $("status");
const facts = $("facts");
const activeFilters = $("active-filters");
const summary = $("summary");
const intro = $("intro");
const frame = $("frame");
const scroller = $("scroller");
const entry = $("entry");
const settings = $<HTMLDialogElement>("settings");
const switches = $("switches");
const help = $<HTMLDialogElement>("help");
const panels = [settings, $<HTMLDialogElement>("filters"), help];

const worker = new Worker(new URL("./search-worker.ts", import.meta.url), { type: "module" });
const send = (message: ToWorker) => worker.postMessage(message);
const loader = setUpLoader($("loader"), $("app"));

let seq = 0; // id of the latest search; older answers are ignored
let ready = false;
let query = ""; // the normalized query on screen
let counts: Counts | null = null; // for `query`
let seeking = -1; // the position a seek is on its way to
let landing: string | null = null; // a suggestion's query: its list shows once it can open at its landing row

const list = new ResultsList(scroller, $("results"), {
  needRows: (from, to) => send({ type: "rows", seq, from, to }),
  choose: (s) => showEntry(s),
});

const slider = new OffsetSlider(frame, {
  state: () =>
    query && counts && counts.occurrences > 0
      ? { query, byOffset: counts.byOffset, complete: counts.total !== null, current: list.topOffset() }
      : null,
  change: (value) => seek(value),
});

// In the Android app, the phone's edge swipe mustn't take a thumb holding the slider's ends.
guardEdges(frame);

// Taps, holds and drags on the list (scroller-gestures.ts): a tap opens a word,
// unless it's a finger putting the keyboard away; a hold on a blank spot opens
// the slider.
new ScrollerGestures(scroller, {
  typing: () => document.activeElement === input,
  dismissKeyboard: () => input.blur(),
  holdStart: (x) => slider.open(x),
  holdMove: (x) => {
    slider.slideTo(x);
    coach.did("scrubbed"); // held and slid: the tour's second step (the next waits for the finger to lift)
  },
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
  else showActiveFilters();
}

/** A switch in Settings: its name, a line on what it does, and what turning it does. */
function addSwitch(id: string, label: string, help: string, on: boolean, turned: (on: boolean) => void): HTMLElement {
  const row = document.createElement("label");
  row.className = "setting";
  row.innerHTML = `<span class="setting-text"><span class="setting-name"></span><span class="setting-help"></span></span>
    <input class="switch" type="checkbox" role="switch" />`;
  row.querySelector(".setting-name")!.textContent = label;
  const line = row.querySelector<HTMLElement>(".setting-help")!;
  line.textContent = help;
  line.id = `${id}-help`;
  const toggle = row.querySelector<HTMLInputElement>("input")!;
  toggle.id = id;
  toggle.setAttribute("aria-describedby", line.id);
  toggle.checked = on;
  toggle.addEventListener("change", () => turned(toggle.checked));
  switches.append(row);
  return row;
}

for (const f of FILTERS) {
  if (f.kind !== "switch") continue;
  addSwitch(f.id, f.label, f.help, filters[f.id] === true, (on) => setFilter(f.id, on)).dataset.filter = f.id;
}

// The ranges (word length) are wheels in the Filters panel, under the cog.
const filtersPanel = new FiltersPanel($<HTMLDialogElement>("filters"), $("ranges"), $<HTMLButtonElement>("filters-open"), filters, setFilter);

/** Under the totals: each range filter that's set, in words, with a cross that
 *  puts it back on Any. Only with results showing, and only filters this index offers. */
function showActiveFilters() {
  const lines: HTMLElement[] = [];
  for (const f of FILTERS) {
    if (f.kind !== "range" || !offered.some((o) => o.id === f.id)) continue;
    const text = describeRange(f, (filters[f.id] ?? [null, null]) as Range);
    if (!text) continue;
    const line = document.createElement("p");
    line.className = "active-filter";
    const words = document.createElement("span");
    words.textContent = text;
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "clear-filter";
    clear.setAttribute("aria-label", `Clear the ${f.label.toLowerCase()} filter`);
    clear.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></svg>`;
    clear.addEventListener("click", () => clearRange(f.id));
    line.append(words, clear);
    lines.push(line);
  }
  activeFilters.replaceChildren(...lines);
  activeFilters.hidden = !query || lines.length === 0;
}

/** A range filter back on Any: the wheels too, and the funnel's dot gone. */
function clearRange(id: string) {
  setFilter(id, [null, null]);
  filtersPanel.offer(offered);
}

let offered: FilterInfo[] = []; // the filters this index has the data for

/** Offer only the filters this index has the data for. */
function offerFilters(available: FilterInfo[]) {
  offered = available;
  const ids = new Set(available.map((f) => f.id));
  for (const row of switches.querySelectorAll<HTMLElement>("[data-filter]")) row.hidden = !ids.has(row.dataset.filter!);
  filtersPanel.offer(available);
  showActiveFilters();
}

// The word list file: ?index= overrides it (tests use a small one), but only
// with a file of the app's own: a link mustn't make the app fetch from elsewhere.
const asked = new URL(new URLSearchParams(location.search).get("index") ?? "headwords.bin", location.href);
const indexUrl = asked.origin === location.origin ? asked : new URL("headwords.bin", location.href);
// Loaded once the start screen has been drawn (two frames on, so it's on the
// screen, not just on its way), so its first frame isn't held up.
requestAnimationFrame(() =>
  requestAnimationFrame(() =>
    setTimeout(() => send({
        type: "load",
        url: indexUrl.href,
        definitions: indexUrl.href.replace(/\.bin$/, ".definitions.bin"),
        where: loader.waits ? "browser" : "app", // a browser shows the app only once all is in
      })),
  ),
);

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

// The background loading channel (a browser with a starter): once the word list is in, a
// worker of its own keeps every data file on this device, and Settings says how far along.
let toKeep: Extract<FromWorker, { type: "starter" }> | null = null;
const offline = $("offline");

function keepOnDevice() {
  if (!toKeep || toKeep.keep.length === 0) return;
  const keeper = new Worker(new URL("./data-worker.ts", import.meta.url), { type: "module" });
  offline.hidden = false;
  offline.textContent = "Saving the dictionary on this device for offline use…";
  keeper.onmessage = ({ data }: MessageEvent<FromDataWorker>) => {
    if (data.type === "keeping") offline.textContent = `Saving the dictionary on this device for offline use… ${Math.floor(data.share * 100)}%`;
    else {
      offline.textContent =
        data.type === "kept"
          ? "Saved on this device: works offline."
          : data.why === "space"
            ? "Not enough space on this device to save the dictionary for offline use."
            : data.why === "saving-data"
              ? "Data Saver is on, so the dictionary isn’t saved for offline use."
              : "Couldn’t save the dictionary for offline use. It still works online.";
      keeper.terminate();
    }
  };
  const message: ToDataWorker = { type: "keep", files: toKeep.keep, alsoKeep: toKeep.alsoKeep };
  keeper.postMessage(message);
}

// The published web app keeps the page itself on the device, to open offline (web/sw.js,
// written by the web build only). Never in the app, nor while developing.
if (import.meta.env.PROD && !Capacitor.isNativePlatform() && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {}); // a build without one: online only
}
// And where the browser offers to install it, Settings has Install (web/install.ts).
offerInstall($("install"), $<HTMLButtonElement>("install-button"), AS_APP);

let shown = false; // the word count and filters, from the starter or the word list
let arrived = 0; // how much of the word list is in, 0 to 1 (a browser, while it comes)

/** The start screen's word count and the filters on offer: from the starter, or the word
 *  list when there's no starter; the app shows from then on. */
function show(words: number, available: FilterInfo[]) {
  if (shown) return;
  shown = true;
  status.textContent = `${words.toLocaleString()} words`;
  facts.textContent = `${words.toLocaleString()} words · every definition · fully offline`;
  facts.classList.add("ready"); // fades in, in the place kept for it
  offerFilters(available);
  loader.done();
}

/** What a search says while the word list is still on its way. */
const stillLoading = () => `Loading the word list…${arrived > 0 ? ` ${Math.floor(arrived * 100)}%` : ""}`;

worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
  switch (data.type) {
    case "starter":
      toKeep = data;
      show(data.words, data.filters);
      break;
    case "progress":
      arrived = data.share;
      if (query && !ready && !frame.hidden && !counts) summary.textContent = stillLoading();
      break;
    case "ready":
      ready = true;
      show(data.words, data.filters);
      keepOnDevice(); // the rest, now the word list is in: nothing it needs is held up
      if (normalize(input.value) && !counts) summary.textContent = "Searching…";
      break;
    case "failed":
      status.textContent = "Word list unavailable";
      facts.textContent = "Word list unavailable";
      facts.classList.add("ready");
      summary.textContent = `Couldn’t load the word list (${data.message}). Reload the app to try again.`;
      loader.failed();
      break;
    case "rows":
      if (data.seq !== seq) return; // an answer to an older search
      if (data.landAt !== undefined) {
        reveal(data);
        break;
      }
      counts = mergeCounts(counts, data.counts);
      list.receive(data.from, data.items, data.known, data.complete);
      restorePlace(data.complete);
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
      restorePlace(counts.total !== null);
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

// The cross at the field's end (shown while typing) clears it and keeps the
// keyboard up: pressing it mustn't take the focus from the box.
const clear = $<HTMLButtonElement>("clear");
for (const type of ["pointerdown", "mousedown"]) clear.addEventListener(type, (event) => event.preventDefault());
clear.addEventListener("click", () => {
  input.value = "";
  input.focus();
  input.dispatchEvent(new Event("input"));
});

/**
 * A suggestion's list arrived: every word counted, and the rows around where it opens
 * (src/landing.ts). Until now the start screen stayed up; the switch to the list, its
 * position, its words and the summary all happen here, before the next frame is drawn,
 * so the list is never seen at its top first and then jumping.
 */
function reveal(data: Extract<FromWorker, { type: "rows" }>) {
  if (landing !== query) return; // typed over meanwhile
  landing = null;
  intro.hidden = true;
  frame.hidden = false;
  input.setAttribute("aria-expanded", "true");
  list.reset(query);
  counts = data.counts;
  list.openAt(data.from, data.items, data.known, data.landAt!);
  describe();
  settleHistory("results");
}

function search(text: string) {
  leaveEntry();
  const next = normalize(text);
  if (next !== landing) landing = null; // typed over it
  if (next !== query) {
    counts = null;
    trail.clear(); // the words followed from the old results
  }
  query = next;
  seeking = -1;
  seq++;
  showActiveFilters();
  if (!query) {
    frame.hidden = true;
    intro.hidden = false;
    summary.textContent = "";
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    settleHistory("start");
    return;
  }
  input.removeAttribute("aria-activedescendant");
  if (landing === query) {
    // A suggestion: the start screen stays until its list can open where it lands (reveal()).
    send({ type: "search", seq, query: text, land: true });
    return;
  }
  intro.hidden = true;
  frame.hidden = false;
  input.setAttribute("aria-expanded", "true");
  if (!ready) summary.textContent = stillLoading();
  list.reset(query);
  send({ type: "search", seq, query: text });
  settleHistory("results");
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
    return;
  }
  if (counts.total === 0) {
    summary.textContent = `Settings or filters hide every word with ${q}.`;
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
    coach.did("scrubbed"); // the slider's way from the keyboard does the tour's step too
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const id = list.move(event.key === "ArrowDown" ? 1 : -1);
    if (id) input.setAttribute("aria-activedescendant", id);
  } else if (event.key === "Enter") {
    // Opens the highlighted word, or the first: the word itself, when typed in
    // full. Its page is for reading, so the keyboard goes.
    const s = list.current();
    if (s) {
      showEntry(s);
      input.blur();
    }
  } else if (event.key === "Escape") {
    input.value = "";
    search("");
  }
});

// Where Back returns to from an open word: the search text, its summary and scroll position.
let returnTo: { text: string; summary: string; scrollTop: number } | null = null;
let entrySeq = 0; // the entry on screen; older answers are dropped
let wordOnScreen: string | null = null; // its key, while a word's page is up (kept with the place)

// The words followed since leaving the results (src/trail.ts). One history
// step stands for all of them, so Back (browser or Android) goes straight to
// the results; a swipe steps along them one word at a time, and a swipe
// forward from the results takes them up again.
const trail = new Trail<Suggestion>();

// The history follows the screen. In an app (web/shell.ts: the Android app, or the web app
// installed from the browser) the results are a step on from the start screen and the words
// followed a step on from the results, so Back goes word → results → start screen → out, as
// an app's does. In a browser tab the results are the page itself and only the words followed
// are a step: Back from them goes to the results, and from the results out of the page.
// Wherever the person goes by hand (clearing the box, a new search on a word's page), the
// steps left behind are taken out, so Back never does nothing.
type Shown = "start" | "results" | "word";
interface Step {
  depth: number; // steps on from the start screen
  trail?: true; // the words followed
}
const RESULTS_DEPTH = AS_APP ? 1 : 0;
const depthOf = (shown: Shown) => (shown === "start" ? 0 : shown === "results" ? RESULTS_DEPTH : RESULTS_DEPTH + 1);
const depthNow = () => (history.state as Step | null)?.depth ?? 0;
const shownNow = (): Shown => (!entry.hidden ? "word" : !frame.hidden ? "results" : "start");
let unwinding = false; // steps back the app asked the history for, not yet taken
// Every start is on the start screen, so its history step is the start screen's: a step kept
// from before (a reload, or a WebView restoring its history) mustn't count.
if (history.state !== null) history.replaceState(null, "");

/** Make the history's steps match the screen `shown`: a step added for each it's ahead,
 *  and the steps past it taken out. */
function settleHistory(shown: Shown) {
  if (unwinding) return; // settled again once those steps are taken (popstate)
  const want = depthOf(shown);
  const now = depthNow();
  for (let depth = now + 1; depth <= want; depth++) {
    const step: Step = depth === depthOf("word") ? { depth, trail: true } : { depth };
    history.pushState(step, "");
  }
  if (want < now) {
    unwinding = true;
    history.go(want - now);
  }
}

let leftSearch: string | null = null; // the search Back to the start screen left, for Forward

/** An app's Back from the results (or past them): the start screen, the search kept for Forward. */
function backToStart() {
  if (shownNow() === "start") return;
  leftSearch = entry.hidden ? input.value : (returnTo?.text ?? input.value);
  input.value = "";
  search("");
}

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
  settleHistory("word");
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
  wordOnScreen = s.key;
  placeChanged(); // a word followed from another: kept too
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
  updateNav(); // forward may have gone (a link followed) or come (a step back)
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
    coach.did("peeked");
  });
}

window.addEventListener("popstate", (event) => {
  if (unwinding) {
    // The steps settleHistory took out: the screen already moved, so only settle again
    // (the person may have gone on meanwhile).
    unwinding = false;
    settleHistory(shownNow());
    return;
  }
  if ((event.state as Step | null)?.trail) {
    // The browser's Forward, back onto the trail: its first word.
    if (trail.depth === 0 && trail.canForward) {
      rememberResults();
      drawEntry(trail.forward()!, "forward");
    }
    return;
  }
  trail.home(); // Back: straight to the results, the words kept for a swipe forward
  if (depthNow() < RESULTS_DEPTH) return backToStart(); // an app: Back from the results
  if (entry.hidden) {
    // An app's Forward from the start screen: the search Back left.
    if (shownNow() === "start" && leftSearch) {
      input.value = leftSearch;
      leftSearch = null;
      search(input.value);
    }
    return;
  }
  leaveEntry();
  if (!returnTo) return search(input.value);
  // The results are still in the list; show them again where they were.
  input.value = returnTo.text;
  summary.textContent = returnTo.summary;
  frame.hidden = false;
  scroller.scrollTop = returnTo.scrollTop; // hiding the list reset it
  input.setAttribute("aria-expanded", "true");
  updateNav();
});

void setUpNativeShell({
  closePanel: () => {
    const open = panels.find((panel) => panel.open);
    open?.close();
    return !!open;
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

// The suggestions on the start screen (web/examples.ts): two lanes drifting
// slowly opposite ways, shuffled each start; tapping one searches for it and
// opens its words around the middle. A tile is a little bigger for a piece
// that finds more words, and its letters lean a little (the tiles stay level).
// Each lane holds its tiles twice, the second set hidden from screen readers,
// so the drift loops without a seam.
const examples = $("examples");
const TILTS = [-1.5, 1, -0.5, 1.5, -1, 0.5, -1.5, 0.5, -0.5, 1];
const pieceCounts = PIECES.map(([, words]) => words);
const DRIFT = 16; // px per second: slow enough to read, quick enough to notice

function tile(piece: string, words: number, i: number, copy: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tile";
  button.dataset.query = piece;
  if (copy) button.tabIndex = -1;
  button.style.setProperty("--k", tileWeight(words, pieceCounts).toFixed(3));
  button.style.setProperty("--tilt", `${TILTS[i % TILTS.length]}deg`);
  const face = document.createElement("span");
  face.className = "tile-face";
  const text = document.createElement("span");
  text.className = "tile-text";
  text.textContent = piece;
  face.append(text);
  button.append(face);
  return button;
}

lanesOf(PIECES, LANES).forEach((pieces, lane) => {
  const box = document.createElement("div");
  box.className = "lane";
  const track = document.createElement("div");
  track.className = "lane-track";
  for (const copy of [false, true]) {
    const set = document.createElement("div");
    set.className = "tile-set";
    if (copy) set.setAttribute("aria-hidden", "true");
    pieces.forEach(([piece, words], i) => set.append(tile(piece, words, i + lane * 5, copy)));
    track.append(set);
  }
  box.append(track);
  examples.append(box);
});

/** One set's width is a lap of the drift; its time follows from the speed. */
function pace() {
  for (const track of examples.querySelectorAll<HTMLElement>(".lane-track")) {
    const lap = (track.firstElementChild as HTMLElement).offsetWidth;
    if (!lap) continue;
    track.style.setProperty("--lap", `${lap}px`);
    track.style.setProperty("--lap-time", `${(lap / DRIFT).toFixed(1)}s`);
  }
}
pace();
new ResizeObserver(pace).observe(examples);

// A finger on a lane holds it still (and a little after), so a tile can be read and tapped.
let release = 0;
examples.addEventListener("pointerdown", () => {
  clearTimeout(release);
  examples.classList.add("held");
});
for (const type of ["pointerup", "pointercancel"])
  window.addEventListener(type, () => {
    clearTimeout(release);
    release = window.setTimeout(() => examples.classList.remove("held"), 1500);
  });
examples.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-query]");
  if (!button) return;
  input.value = button.dataset.query ?? "";
  // Leave the keyboard closed, so the results have the whole screen to explore.
  input.blur();
  landing = normalize(input.value);
  search(input.value);
});

// Browser storage for settings and the tour. It can be missing or blocked; then
// settings fall back to their defaults and the tour shows again.
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
function forget(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing to forget
  }
}

// The seam sits a fixed share of the row width from the left edge.
const placeSeam = () => {
  const pad = parseFloat(getComputedStyle(frame).getPropertyValue("--pad")) * 16 || 20;
  const width = (frame.clientWidth || document.documentElement.clientWidth) - 2 * pad;
  const seam = Math.round(Math.min(220, Math.max(88, width * 0.34)));
  document.documentElement.style.setProperty("--seam-x", `${seam}px`);
};
new ResizeObserver(placeSeam).observe(document.body);
placeSeam();

// How It Works: the "?" beside the cog lists the controls (web/guide.ts), and can start the
// tour again. The tour itself: four things to do on a first run, each shown, then asked for
// (web/coach.ts, web/tour-shows.ts). Only the person's own actions are reported to it.
const guide = $("guide");
for (const c of CONTROLS) {
  const how = document.createElement("dt");
  how.textContent = c.how;
  const does = document.createElement("dd");
  does.textContent = c.does;
  guide.append(how, does);
}
$("help-open").addEventListener("click", () => help.showModal());

// Light or dark: the switch at the top right of Settings (web/theme.ts), kept on the device.
setUpTheme($<HTMLButtonElement>("theme"), { read, write, forget });

// Back, home and forward, for a mouse: over the top of the list or a word's page. Back and
// forward step through the words followed, as a swipe does; back from the list, and home,
// go to the start screen. On by default in a desktop browser, off on a phone and in the app;
// a switch in Settings, kept on the device.
const NAV_KEY = "dictionarius.nav";
const nav = $("nav");
const navForward = $<HTMLButtonElement>("nav-forward");
const navByDefault = () => !Capacitor.isNativePlatform() && !matchMedia("(pointer: coarse)").matches;
let navOn = (read(NAV_KEY) ?? (navByDefault() ? "on" : "off")) === "on";
function updateNav() {
  const hide = !navOn || !intro.hidden || (frame.hidden && entry.hidden);
  // Only when it changes: the screen watcher below hears every "hidden" set inside the app.
  if (nav.hidden !== hide) nav.hidden = hide;
  navForward.disabled = !trail.canForward;
}
function goToStart() {
  input.value = "";
  search("");
}
$("nav-back").addEventListener("click", () => (entry.hidden ? goToStart() : step("back")));
$("nav-home").addEventListener("click", goToStart);
navForward.addEventListener("click", () => step("forward"));
addSwitch("nav-buttons", "Navigation buttons", "Back, forward and the start screen, at the top.", navOn, (on) => {
  navOn = on;
  write(NAV_KEY, on ? "on" : "off");
  updateNav();
});

const TOUR_KEY = "dictionarius.tour";
const hands = new Hands();
const coach = new Coach(
  new Tour(read(TOUR_KEY)),
  { card: $("coach"), count: $("coach-count"), text: $("coach-text"), skip: $<HTMLButtonElement>("coach-skip") },
  tourShows({
    hands,
    touch: $("coach-touch"),
    pieces: examples,
    scroller,
    funnel: $("filters-open"),
    filters: $<HTMLDialogElement>("filters"),
    cog: $("settings-open"),
    settings,
    slider,
    holdPlace: () => {
      const top = scroller.scrollTop;
      return () => {
        seeking = -1; // a seek still on its way was the show's
        scroller.scrollTop = top;
      };
    },
  }),
  (value) => (value === null ? forget(TOUR_KEY) : write(TOUR_KEY, value)),
  hands,
);
// Show me again: the tour from the top, on the start screen where it begins, every word in
// play (the funnel's filters cleared).
$("help-tour").addEventListener("click", () => {
  help.close();
  goToStart();
  for (const f of FILTERS) {
    const range = filters[f.id] as Range;
    if (f.kind === "range" && (range[0] !== null || range[1] !== null)) clearRange(f.id);
  }
  coach.restart();
});
// A sheet opened from the funnel or the cog, and closed again: back on the list, its step done.
$("filters").addEventListener("close", () => coach.did("filtered"));
settings.addEventListener("close", () => coach.did("set"));

const screenNow = (): Screen => (!intro.hidden ? "start" : !frame.hidden ? "results" : "elsewhere");
const watchScreens = () => {
  updateNav();
  const screen = screenNow();
  if (screen === "results") coach.did("searched"); // a piece or a typed search: the list is up
  coach.on(screen);
};
new MutationObserver(watchScreens).observe(document.getElementById("app")!, { attributes: true, attributeFilter: ["hidden"], subtree: true });
watchScreens(); // the start screen's first frame has the tour's note in place, if it's showing

// Where the person was (web/place.ts), in an app (the Android app, or the web app installed
// from the browser): kept as it changes (a moment after the search, the scroll or the word
// does) and as it goes to the background, and restored on the next start, so that when the
// phone closes it in the background (cheap phones do, often) it comes back to the same
// search, scroll and word. As it changes, not only on the way out: a WebView may never hear
// it was hidden before the kill. A page in a browser tab that's reloaded starts fresh.
const PLACE_KEY = "dictionarius.place";
let placeToFinish: Place | null = null; // restored search: its scroll and word still to come
function keepPlace() {
  const onWord = !entry.hidden;
  const kept = placeToKeep(
    {
      query: onWord ? (returnTo?.text ?? "") : input.value,
      scrollTop: onWord ? (returnTo?.scrollTop ?? 0) : scroller.scrollTop,
      word: onWord ? wordOnScreen : null,
    },
    Date.now(),
  );
  if (kept === null) forget(PLACE_KEY);
  else write(PLACE_KEY, kept);
}
/** How long the place settles before it's kept (ms): a fling or typing is kept once. */
const PLACE_SETTLE_MS = 400;
let placeTimer = 0;
function placeChanged() {
  if (!AS_APP) return; // an app's only
  if (placeToFinish) return; // still coming back: the place it's restoring is the one to keep
  clearTimeout(placeTimer);
  placeTimer = window.setTimeout(keepPlace, PLACE_SETTLE_MS);
}
/** The restored search's rows are in: scroll back once the list is long enough (or
 *  complete), then open the word that was open. */
function restorePlace(complete: boolean) {
  const place = placeToFinish;
  if (!place || frame.hidden) return;
  const room = scroller.scrollHeight - scroller.clientHeight;
  if (room < place.scrollTop && !complete) return; // not that far down yet: wait for more rows
  placeToFinish = null;
  scroller.scrollTop = place.scrollTop;
  if (place.word) void wordNamed(place.word).then((s) => s && showEntry(s));
  else placeChanged(); // back: kept again, as it is now
}
if (AS_APP) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") keepPlace();
  });
  window.addEventListener("pagehide", keepPlace);
  scroller.addEventListener("scroll", placeChanged, { passive: true });
  input.addEventListener("input", placeChanged);
  new MutationObserver(placeChanged).observe(document.getElementById("app")!, { attributes: true, attributeFilter: ["hidden"], subtree: true });
  const place = placeToRestore(read(PLACE_KEY), Date.now());
  forget(PLACE_KEY); // once: a later start is fresh unless it's kept again
  if (place) {
    placeToFinish = place;
    input.value = place.query;
    search(place.query);
  }
}
