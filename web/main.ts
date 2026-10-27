import "@fontsource-variable/literata/opsz.css";
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "./styles.css";

import type { Suggestion } from "../src/complete";
import { normalize } from "../src/normalize";
import { sourcePageUrl } from "../src/attribution";
import type { FromWorker, ToWorker } from "./protocol";
import { ResultsList } from "./results-list";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>("q");
const status = $("status");
const summary = $("summary");
const intro = $("intro");
const frame = $("frame");
const scroller = $("scroller");
const entry = $("entry");

const worker = new Worker(new URL("./search-worker.ts", import.meta.url), { type: "module" });
const send = (message: ToWorker) => worker.postMessage(message);

let seq = 0; // id of the latest search; older answers are ignored
let ready = false;

const list = new ResultsList(scroller, $("results"), {
  needMore: () => send({ type: "more", seq }),
  choose: (s) => showEntry(s),
});

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
      list.append(data.items, data.done);
      describe(data.query, data.prefixCount, data.occurrences);
      break;
  }
};

input.addEventListener("input", () => search(input.value));

function search(text: string) {
  entry.hidden = true;
  const query = normalize(text);
  seq++;
  if (!query) {
    frame.hidden = true;
    intro.hidden = false;
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

function describe(query: string, prefixCount: number, occurrences: number) {
  const q = `“${query}”`;
  if (occurrences === 0) {
    summary.textContent = `No word contains ${q}. Try a shorter piece.`;
  } else if (prefixCount === 0) {
    summary.textContent = `No word starts with ${q}; these contain it.`;
  } else {
    const starts = `${prefixCount.toLocaleString()} ${prefixCount === 1 ? "word starts" : "words start"} with ${q}`;
    // More occurrences than prefix words means some word contains it further in.
    summary.textContent = occurrences > prefixCount ? `${starts}; more contain it.` : starts;
  }
}

input.addEventListener("keydown", (event) => {
  if (frame.hidden) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
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

function showEntry(s: Suggestion) {
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

for (const button of document.querySelectorAll<HTMLButtonElement>(".examples button")) {
  button.addEventListener("click", () => {
    input.value = button.dataset.query ?? "";
    input.focus();
    search(input.value);
  });
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
