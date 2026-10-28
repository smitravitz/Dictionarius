/**
 * Runs the search off the main thread: loads the headword index once, keeps
 * the current search and a cursor into it, and answers each request with one
 * page. Between requests it counts the rest of the matches, so the summary and
 * the position slider get exact numbers without slowing the first page.
 */
import { HeadwordIndex } from "../src/headword-index";
import { Completer, type Matches, type ResultCursor } from "../src/complete";
import { normalize } from "../src/normalize";
import { PAGE_SIZE, type Counts, type FromWorker, type ToWorker } from "./protocol";

/** Longest one reply may take. A page can come back short; the page asks again. */
const SLICE_MS = 40;
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
let cursor: ResultCursor | null = null;
let cursorSeq = -1;
let countTimer: ReturnType<typeof setTimeout> | undefined;

scope.onmessage = ({ data }) => {
  switch (data.type) {
    case "load":
      void load(data.url);
      break;
    case "search":
      if (completer) search(data);
      else waiting = data;
      break;
    case "more":
      if (cursor && data.seq === cursorSeq) sendPage(cursor);
      break;
  }
};

async function load(url: string) {
  const started = performance.now();
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} loading ${url}`);
    const index = HeadwordIndex.fromBytes(new Uint8Array(await response.arrayBuffer()));
    completer = new Completer(index);
    scope.postMessage({ type: "ready", words: index.size, ms: performance.now() - started });
    if (waiting) search(waiting);
    waiting = null;
  } catch (error) {
    scope.postMessage({ type: "failed", message: error instanceof Error ? error.message : String(error) });
  }
}

function search({ seq, query, fromOffset }: { seq: number; query: string; fromOffset: number }) {
  // Moving the position slider re-asks for the same query: keep its counts.
  if (!matches || matches.query !== normalize(query)) matches = completer!.search(query);
  cursor = matches.cursor(fromOffset);
  cursorSeq = seq;
  sendPage(cursor);
  countInBackground(matches);
}

function sendPage(c: ResultCursor) {
  const items = [];
  const started = performance.now();
  do {
    items.push(...c.next(PAGE_SIZE - items.length));
  } while (items.length < PAGE_SIZE && !c.done && performance.now() - started < SLICE_MS);
  scope.postMessage({
    type: "page",
    seq: cursorSeq,
    query: c.query,
    fromOffset: c.fromOffset,
    items,
    done: c.done,
    counts: countsOf(matches!),
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
  };
}
