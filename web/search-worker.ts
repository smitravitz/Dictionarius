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
import { DefinitionsFile, LAYERS, bytesSource, layerUrl, rangeSource, type ByteSource, type Layer } from "../src/definitions";
import { landingRow } from "../src/landing";
import { PAGE_SIZE, type Counts, type FromWorker, type ToWorker } from "./protocol";
import { PIECES } from "./examples";

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
// The start screen's suggestions, counted ahead while the worker is idle, so tapping one
// opens its list at once (landOn has nothing left to count). About 2.5 MB of word ids
// for all of them. Kept for the filters they were counted with; new settings start over.
const ahead = new Map<string, Matches>();
let aheadFilters = "";
let aheadTimer: ReturnType<typeof setTimeout> | undefined;
const AHEAD_PAUSE_MS = 4; // between slices: a search's own counting comes first
// The definitions, loaded after the index: the core file and whichever layers are
// there (examples, etymology, pronunciation); null when there's no core (or it doesn't fit the index).
let found: (file: DefinitionsFile | null) => void = () => {};
const definitions = new Promise<DefinitionsFile | null>((resolve) => (found = resolve));
const DEFINITIONS_AFTER_MS = 1500;
let startDefinitions = () => {}; // set once the index is in
let definitionsTimer: ReturnType<typeof setTimeout> | undefined;

scope.onmessage = ({ data }) => {
  switch (data.type) {
    case "load":
      void load(data.url, data.definitions, data.where);
      break;
    case "definitions": {
      startDefinitions(); // wanted now: no more waiting
      const { ask, id } = data;
      void definitions
        .then((file) => file?.of(id) ?? null)
        .catch(() => null)
        .then((answer) => scope.postMessage({ type: "definitions", ask, definitions: answer }));
      break;
    }
    case "word":
      scope.postMessage({ type: "word", ask: data.ask, suggestion: completer?.word(data.text) ?? null });
      break;
    case "settings":
      filters = data.filters;
      setTimeout(() => completer?.prepare(filters), 0);
      countAhead();
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

async function load(url: string, definitionsUrl: string, where: "browser" | "app") {
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
    countAhead();
    // The definitions (the bigger file) once the start screen has settled, or
    // as soon as a word's are asked for.
    startDefinitions = () => {
      startDefinitions = () => {};
      clearTimeout(definitionsTimer);
      void loadDefinitions(definitionsUrl, index, where === "app");
    };
    if (where === "browser") startDefinitions();
    else definitionsTimer = setTimeout(() => startDefinitions(), DEFINITIONS_AFTER_MS);
  } catch (error) {
    scope.postMessage({ type: "failed", message: error instanceof Error ? error.message : String(error) });
  }
}

/** The definitions for `index` (the core file at `url`, its layers beside it), or
 *  null when there's no core or it was built for another word list. A layer that's
 *  missing or doesn't fit is left out: the page shows what there is. `inPlace`: read
 *  each file a block at a time with Range requests, where the server sends exact
 *  ranges (the app's does: RangedAssets.java), else hold it whole. */
async function loadDefinitions(url: string, index: HeadwordIndex, inPlace: boolean) {
  const fetched = async (at: string) => {
    try {
      const ranged = inPlace ? await rangeSource(at) : null;
      if (ranged) return ranged;
      const response = await fetch(at);
      return response.ok ? bytesSource(new Uint8Array(await response.arrayBuffer())) : null;
    } catch {
      return null;
    }
  };
  const [core, ...layers] = await Promise.all([fetched(url), ...LAYERS.map((kind) => fetched(layerUrl(url, kind)))]);
  try {
    if (!core) throw new Error(`no ${url}`);
    const kept: Partial<Record<Layer, ByteSource>> = {};
    for (const [i, kind] of LAYERS.entries()) {
      if (!layers[i]) continue;
      try {
        await DefinitionsFile.open(core, index, { [kind]: layers[i] }); // fits this core? (reads headers only)
        kept[kind] = layers[i];
      } catch (error) {
        console.warn(`left out ${kind}:`, error instanceof Error ? error.message : error);
      }
    }
    found(await DefinitionsFile.open(core, index, kept));
  } catch (error) {
    console.warn("no definitions:", error instanceof Error ? error.message : error);
    found(null);
  }
  scope.postMessage({ type: "loaded" });
}

function search({ seq, query, land }: Extract<ToWorker, { type: "search" }>) {
  // Re-asking for the same query (a setting unchanged) keeps the work done.
  if (!matches || matches.query !== normalize(query) || matchesFilters !== filterKey(filters)) {
    const counted = aheadFilters === filterKey(filters) ? ahead.get(normalize(query)) : undefined;
    matches = counted ?? completer!.search(query, { filters });
    matchesFilters = filterKey(filters);
  }
  matchesSeq = seq;
  if (land) landOn(matches);
  else {
    sendRows(0, PAGE_SIZE);
    countInBackground(matches);
  }
}

/** Rows sent around a landing: the screen's worth below it (a tall one), and the
 *  results list's overscan above, so its first paint has every word it shows. */
const LAND_ABOVE = 8;
const LAND_BELOW = 60;

/** A suggestion's search: count every word (in slices, so a newer search can take
 *  over), pick the row its list opens at, and send the rows there in one answer. The
 *  page shows nothing of it until then, so it never paints the top and then jumps. */
function landOn(m: Matches) {
  clearTimeout(countTimer);
  const slice = () => {
    if (m !== matches) return; // a newer search took over
    const started = performance.now();
    while (!m.complete && performance.now() - started < COUNT_SLICE_MS) m.count(20_000);
    if (!m.complete) {
      countTimer = setTimeout(slice, 0);
      return;
    }
    const row = landingRow(m.byOffset.reduce((a, b) => a + b, 0)) ?? 0;
    const from = Math.max(0, Math.floor((row - LAND_ABOVE) / PAGE_SIZE) * PAGE_SIZE);
    const to = Math.ceil((row + LAND_BELOW) / PAGE_SIZE) * PAGE_SIZE;
    sendRows(from, to, undefined, row);
  };
  slice();
}

function sendRows(from: number, to: number, seek?: { offset: number; row: number }, landAt?: number) {
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
    landAt,
  });
}

/** Count the start screen's suggestions ahead, one slice at a time, in the gaps between
 *  everything else the worker does. */
function countAhead() {
  clearTimeout(aheadTimer);
  if (!completer) return; // starts once the index is in
  const key = filterKey(filters);
  if (key !== aheadFilters) {
    ahead.clear();
    aheadFilters = key;
  }
  const slice = () => {
    const piece = PIECES.map(([p]) => normalize(p)).find((q) => !ahead.get(q)?.complete);
    if (piece === undefined || !completer || aheadFilters !== filterKey(filters)) return;
    let m = ahead.get(piece);
    if (!m) {
      m = completer.search(piece, { filters });
      ahead.set(piece, m);
    }
    const started = performance.now();
    while (!m.complete && performance.now() - started < COUNT_SLICE_MS) m.count(20_000);
    aheadTimer = setTimeout(slice, AHEAD_PAUSE_MS);
  };
  aheadTimer = setTimeout(slice, AHEAD_PAUSE_MS);
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
