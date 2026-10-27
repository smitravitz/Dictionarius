/**
 * Runs the search off the main thread: loads the headword index once, keeps a
 * cursor for the current search, and answers each request with one page.
 */
import { HeadwordIndex } from "../src/headword-index";
import { Completer, type ResultCursor } from "../src/complete";
import { PAGE_SIZE, type FromWorker, type ToWorker } from "./protocol";

/** Longest one reply may take. A page can come back short; the page asks again. */
const SLICE_MS = 40;

interface WorkerScope {
  postMessage(message: FromWorker): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;

let completer: Completer | null = null;
let waiting: { seq: number; query: string } | null = null; // typed before the index loaded
let cursor: ResultCursor | null = null;
let cursorSeq = -1;

scope.onmessage = ({ data }) => {
  switch (data.type) {
    case "load":
      void load(data.url);
      break;
    case "search":
      if (completer) search(data.seq, data.query);
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
    if (waiting) search(waiting.seq, waiting.query);
    waiting = null;
  } catch (error) {
    scope.postMessage({ type: "failed", message: error instanceof Error ? error.message : String(error) });
  }
}

function search(seq: number, query: string) {
  cursor = completer!.complete(query);
  cursorSeq = seq;
  sendPage(cursor);
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
    items,
    done: c.done,
    prefixCount: c.prefixCount,
    occurrences: c.occurrences,
  });
}
