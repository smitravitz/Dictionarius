/**
 * Runs the search off the main thread: loads the headword index once, keeps
 * the current search and a cursor into it, and answers each request with one
 * page. Between requests it counts the rest of the matches, so the summary and
 * the position slider get exact numbers without slowing the first page.
 */
import { HeadwordIndex } from "../src/headword-index";
import { Completer, type Matches } from "../src/complete";
import { normalize } from "../src/normalize";
import { SAFE_SEARCH_OVERRIDES } from "../src/safe-search-overrides";
import { defaultFilters, filterKey, type FilterState } from "../src/filters";
import { PAGE_SIZE, type Counts, type FromWorker, type ToWorker } from "./protocol";

/** Background counting runs in slices this long, so requests aren't held up. */
const COUNT_SLICE_MS = 12;

interface WorkerScope {
  postMessage(message: FromWorker): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;

let completer: Completer | null = null;
let waiting: Extract<ToWorker, { type: "search" }> | null = null; // typed before the index loaded
let matches: Matches | null = null;
let matchesSeq = -1;
let countTimer: ReturnType<typeof setTimeout> | undefined;
let filters: FilterState = defaultFilters(); // the page sends the saved settings before loading
let matchesFilters = filterKey(filters);

scope.onmessage = ({ data }) => {
  switch (data.type) {
    case "load":
      void load(data.url);
      break;
    case "settings":
      filters = data.filters;
      setTimeout(() => completer?.prepare(filters), 0);
      break;
    case "search":
      if (completer) search(data);
      else waiting = data;
      break;
    case "rows":
      if (matches && data.seq === matchesSeq) sendRows(data.from, data.to);
      break;
    case "seek":
      if (matches && data.seq === matchesSeq) {
        const row = matches.startOf(data.offset);
        sendRows(row, row + PAGE_SIZE, { offset: data.offset, row });
      }
      break;
  }
};

async function load(url: string) {
  const started = performance.now();
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} loading ${url}`);
    const index = HeadwordIndex.fromBytes(new Uint8Array(await response.arrayBuffer()));
    completer = new Completer(index, SAFE_SEARCH_OVERRIDES);
    const available = completer.availableFilters();
    scope.postMessage({ type: "ready", words: index.size, ms: performance.now() - started, filters: available });
    if (waiting) search(waiting);
    waiting = null;
    // Work out the filters' words now, before the first search needs them.
    setTimeout(() => completer?.prepare(filters), 0);
  } catch (error) {
    scope.postMessage({ type: "failed", message: error instanceof Error ? error.message : String(error) });
  }
}

function search({ seq, query }: { seq: number; query: string }) {
  // Re-asking for the same query (a setting unchanged) keeps the work done.
  if (!matches || matches.query !== normalize(query) || matchesFilters !== filterKey(filters)) {
    matches = completer!.search(query, { filters });
    matchesFilters = filterKey(filters);
  }
  matchesSeq = seq;
  sendRows(0, PAGE_SIZE);
  countInBackground(matches);
}

function sendRows(from: number, to: number, seek?: { offset: number; row: number }) {
  const m = matches!;
  const items = m.rows(from, to);
  scope.postMessage({
    type: "rows",
    seq: matchesSeq,
    query: m.query,
    from,
    items,
    known: m.known,
    complete: m.complete,
    counts: countsOf(m),
    seek,
  });
}

function countInBackground(m: Matches) {
  clearTimeout(countTimer);
  if (m.complete) return;
  const slice = () => {
    if (m !== matches) return; // a newer search took over
    const started = performance.now();
    while (!m.complete && performance.now() - started < COUNT_SLICE_MS) m.count(20_000);
    if (m.complete) scope.postMessage({ type: "counts", query: m.query, counts: countsOf(m) });
    else countTimer = setTimeout(slice, 0);
  };
  countTimer = setTimeout(slice, 0);
}

function countsOf(m: Matches): Counts {
  return {
    starts: m.starts,
    ends: m.ends,
    occurrences: m.occurrences,
    byOffset: [...m.byOffset],
    total: m.total,
    filters: matchesFilters,
    filtered: m.filtered,
  };
}
