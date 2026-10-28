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
import { setUpNativeShell } from "./native";
import { EXAMPLES, exampleLabel } from "./examples";

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
const safeSwitch = $<HTMLInputElement>("safe-search");

const worker = new Worker(new URL("./search-worker.ts", import.meta.url), { type: "module" });
const send = (message: ToWorker) => worker.postMessage(message);

let seq = 0; // id of the latest search; older answers are ignored
let ready = false;
let query = ""; // the normalized query on screen
let fromOffset = 0; // letters before the match the list starts at (the slider's position)
let counts: Counts | null = null; // for `query`

const list = new ResultsList(scroller, $("results"), {
  needMore: () => send({ type: "more", seq }),
  choose: (s) => showEntry(s),
  busy: () => slider.active,
});

const slider = new OffsetSlider(frame, scroller, {
  state: () =>
    query && counts && counts.occurrences > 0
      ? { query, value: fromOffset, byOffset: counts.byOffset, complete: counts.total !== null }
      : null,
  change: (value) => seek(value),
  used: () => {
    hint.hidden = true;
    remember(HINT_SEEN);
  },
});

// Settings live in browser storage; safe search is on unless turned off.
const SAFE_SEARCH = "dictionarius.safe-search";
safeSwitch.checked = read(SAFE_SEARCH) !== "off";
send({ type: "settings", safe: safeSwitch.checked });

// The word list file: ?index= overrides it (tests use a small one).
const indexUrl = new URLSearchParams(location.search).get("index") ?? "headwords.bin";
send({ type: "load", url: new URL(indexUrl, location.href).href });

worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
  switch (data.type) {
    case "ready":
      ready = true;
      status.textContent = `${data.words.toLocaleString()} words`;
      if (normalize(input.value)) summary.textContent = "Searching…";
      break;
    case "failed":
      status.textContent = "Word list unavailable";
      summary.textContent = `Couldn’t load the word list (${data.message}). Check your connection and reload the page.`;
      break;
    case "page":
      if (data.seq !== seq) return; // an answer to an older search
      counts = mergeCounts(counts, data.counts);
      list.append(data.items, data.done);
      describe();
      break;
    case "counts":
      if (data.query !== query || data.counts.safe !== safeSwitch.checked) return;
      counts = data.counts;
      describe();
      break;
  }
};

/** Keep whichever counts know more: background counting can finish before a page. */
function mergeCounts(old: Counts | null, next: Counts): Counts {
  if (!old || old.occurrences !== next.occurrences || old.starts !== next.starts) return next;
  return old.total !== null || old.byOffset.length > next.byOffset.length ? old : next;
}

input.addEventListener("input", () => search(input.value));

function search(text: string) {
  entry.hidden = true;
  const next = normalize(text);
  if (next !== query) counts = null;
  query = next;
  fromOffset = 0;
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
  send({ type: "search", seq, query: text, fromOffset });
}

/** Show the same search starting at words with `offset` letters before the match. */
function seek(offset: number) {
  if (!query || offset === fromOffset || offset < 0) return;
  fromOffset = offset;
  seq++;
  input.removeAttribute("aria-activedescendant");
  list.reset(query);
  describe();
  send({ type: "search", seq, query, fromOffset });
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
    summary.textContent = `Safe search hides every word with ${q}. You can turn it off in Settings.`;
    hint.hidden = true;
    return;
  }
  const total = counts.total !== null ? fmt(counts.total) : `about ${roughly(counts.occurrences)}`;
  if (fromOffset === 0) {
    const { starts, ends } = counts;
    summary.textContent =
      `${fmt(starts)} ${starts === 1 ? "starts" : "start"} with ${q} · ` +
      `${fmt(ends)} ${ends === 1 ? "ends" : "end"} with it · ${total} in all`;
  } else {
    const here = counts.byOffset[fromOffset];
    const letters = `${fromOffset} ${fromOffset === 1 ? "letter" : "letters"} before ${q}`;
    summary.textContent = `${here === undefined ? "Words" : fmt(here)} with ${letters} · ${total} in all`;
  }
  hint.hidden = seen(HINT_SEEN);
}

input.addEventListener("keydown", (event) => {
  if (frame.hidden) return;
  if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    // The keyboard's way to move the position slider.
    event.preventDefault();
    const last = counts ? counts.byOffset.length - (counts.total !== null ? 1 : 0) : fromOffset + 1;
    seek(Math.min(last, Math.max(0, fromOffset + (event.key === "ArrowRight" ? 1 : -1))));
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

function showEntry(s: Suggestion) {
  if (!frame.hidden) returnTo = { text: input.value, summary: summary.textContent ?? "", scrollTop: scroller.scrollTop };
  // One history step per open word, so Back (browser or Android) closes it.
  if (!history.state?.entry) history.pushState({ entry: true }, "");
  input.value = s.display;
  frame.hidden = true;
  intro.hidden = true;
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  summary.textContent = "";

  $("entry-word").textContent = s.display;
  const others = s.forms.filter((f) => f !== s.display);
  $("entry-forms").textContent = others.length ? `Also written ${others.join(", ")}` : "";
  const page = sourcePageUrl({ headword: s.display, senses: [], attribution: { source: "Wiktionary", license: "CC-BY-SA-4.0" } });
  $<HTMLAnchorElement>("entry-link").href = page ?? "https://en.wiktionary.org";
  entry.hidden = false;
}

window.addEventListener("popstate", () => {
  if (entry.hidden) return;
  entry.hidden = true;
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
    if (!settings.open) return false;
    settings.close();
    return true;
  },
  clearSearch: () => {
    if (!input.value) return false;
    input.value = "";
    search("");
    return true;
  },
});

// Settings: the cog opens them; Done, Escape, or a tap outside closes them.
$("settings-open").addEventListener("click", () => settings.showModal());
settings.addEventListener("click", (event) => {
  if (event.target === settings) settings.close(); // the backdrop, outside the panel
});
safeSwitch.addEventListener("change", () => {
  write(SAFE_SEARCH, safeSwitch.checked ? "on" : "off");
  send({ type: "settings", safe: safeSwitch.checked });
  counts = null; // counted under the old setting
  if (query) search(input.value); // show the list again under the new setting
});

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
