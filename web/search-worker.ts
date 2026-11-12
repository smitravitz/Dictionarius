/**
 * Runs the search off the main thread: loads the headword index once, keeps
 * the current search and a cursor into it, and answers each request with one
 * page. Between requests it counts the rest of the matches, so the summary and
 * the position slider get exact numbers without slowing the first page.
 *
 * In a browser it starts from the starter (src/starter.ts), a small file: the app shows
 * from it, its suggestions open from it and its words' pages are read from the
 * definitions a block at a time, while the word list comes (gzipped) in the background.
 * What the starter can't answer waits for the word list, then is answered.
 */
import { HeadwordIndex } from "../src/headword-index";
import { Completer, countsOf, type Matches, type Suggestion } from "../src/complete";
import { normalize } from "../src/normalize";
import { SAFE_SEARCH_OVERRIDES } from "../src/safe-search-overrides";
import { defaultFilters, filterKey, type FilterState } from "../src/filters";
import { DefinitionsFile, LAYERS, Unreachable, layerUrl, openSource, type ByteSource, type Layer, type WordKeys } from "../src/definitions";
import { landingFrom, rowsFrom, starterKeys, type Starter } from "../src/starter";
import { fetchStarter, fetchWordList, nameOf, versioned } from "./data-files";
import { definitionsSource } from "./data-cache";
import { starterUrl } from "../src/starter";
import { landingRow, landingWindow } from "../src/landing";
import { PAGE_SIZE, type FromWorker, type ToWorker } from "./protocol";
import { PIECES } from "./examples";

/** Background counting runs in slices this long, so requests aren't held up. */
const COUNT_SLICE_MS = 12;

interface WorkerScope {
  postMessage(message: FromWorker): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;

let index: HeadwordIndex | null = null;
let completer: Completer | null = null;
let waiting: Extract<ToWorker, { type: "search" }> | null = null; // typed before the index loaded
// A browser's starter, and what it couldn't answer before the word list was in: the
// suggestion's list it opened (carried on with the word list), rows past its landings, links.
let starter: Starter | null = null;
let early: { seq: number; query: string } | null = null;
let later: Extract<ToWorker, { type: "rows" | "seek" }>[] = [];
let wordsLater: Extract<ToWorker, { type: "word" }>[] = [];
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
// Rejected when the network couldn't be reached: the next question loads them again.
let found: (file: DefinitionsFile | null) => void = () => {};
let lost: (error: unknown) => void = () => {};
let definitions = expectDefinitions();
let reloadDefinitions = () => {}; // set by loadDefinitions
function expectDefinitions() {
  const coming = new Promise<DefinitionsFile | null>((resolve, reject) => ((found = resolve), (lost = reject)));
  coming.catch(() => {}); // heard by the next question
  return coming;
}
/** The definitions file; if it couldn't be reached last time, tried again now. */
async function definitionsFile() {
  const tried = definitions;
  try {
    return await tried;
  } catch {
    if (definitions === tried) reloadDefinitions();
    return definitions;
  }
}
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
      void definitionsFile()
        .then((file) => file?.of(id) ?? null)
        .then(
          (answer) => scope.postMessage({ type: "definitions", ask, definitions: answer }),
          () => scope.postMessage({ type: "definitions", ask, definitions: null, unavailable: true }), // no network
        );
      break;
    }
    case "word":
      if (completer) scope.postMessage({ type: "word", ask: data.ask, suggestion: completer.word(data.text) });
      else wordsLater.push(data);
      break;
    case "settings":
      filters = data.filters;
      setTimeout(() => completer?.prepare(filters), 0);
      countAhead();
      break;
    case "search":
      if (completer) search(data);
      else if (!fromStarter(data)) {
        waiting = data;
        early = null;
      }
      break;
    case "rows":
    case "seek":
      if (matches && data.seq === matchesSeq) answer(data);
      else if (early && data.seq === early.seq) {
        const rows = data.type === "rows" ? rowsFrom(starter!, early.query, filterKey(filters), data.from, data.to) : null;
        if (rows && data.type === "rows") sendStarterRows(early.seq, early.query, data.from, rows);
        else later.push(data); // past the starter's rows: once the word list is in
      }
      break;
  }
};

async function load(url: string, definitionsUrl: string, where: "browser" | "app") {
  const started = performance.now();
  try {
    // A browser: the starter first, and the app shows from it; then the word list.
    starter = where === "browser" ? await fetchStarter(url) : null;
    if (starter) {
      scope.postMessage({ type: "starter", words: starter.words, filters: starter.available, ...toKeep(url, definitionsUrl, starter) });
      void loadDefinitions(definitionsUrl, earlyKeys(starter), true);
    }
    const loaded = HeadwordIndex.fromBytes(await fetchWordList(url, starter, (share) => scope.postMessage({ type: "progress", share })));
    index = loaded;
    completer = new Completer(loaded, SAFE_SEARCH_OVERRIDES);
    const available = completer.availableFilters();
    scope.postMessage({ type: "ready", words: loaded.size, ms: performance.now() - started, filters: available });
    if (starter && hex(loaded.keysHash()) !== starter.keysHash) {
      // A starter from another word list (a deploy caught halfway): the word list's own.
      starter = null;
      early = null;
      definitions = expectDefinitions();
      void loadDefinitions(definitionsUrl, loaded, true);
    }
    carryOn();
    // Work out the filters' words now, before the first search needs them.
    setTimeout(() => completer?.prepare(filters), 0);
    countAhead();
    if (starter) return; // the definitions are open already
    // The definitions (the bigger files), read a block at a time: in a browser now, in the
    // app once the start screen has settled, or as soon as a word's are asked for.
    startDefinitions = () => {
      startDefinitions = () => {};
      clearTimeout(definitionsTimer);
      void loadDefinitions(definitionsUrl, loaded, true);
    };
    if (where === "browser") startDefinitions();
    else definitionsTimer = setTimeout(() => startDefinitions(), DEFINITIONS_AFTER_MS);
  } catch (error) {
    scope.postMessage({ type: "failed", message: error instanceof Error ? error.message : String(error) });
  }
}

/** The data files to keep on the device, by versioned address: the word list (gzipped when
 *  there's a copy) and the definitions with their layers, as many as the starter lists. */
function toKeep(url: string, definitionsUrl: string, from: Starter) {
  const name = nameOf(url);
  const list = from.files[`${name}.gz`] ? `${url}.gz` : url;
  const addresses = [list, definitionsUrl, ...LAYERS.map((kind) => layerUrl(definitionsUrl, kind))];
  const keep = addresses
    .map((at) => ({ at, file: from.files[nameOf(at)] }))
    .filter(({ file }) => file)
    .map(({ at, file }) => ({ url: versioned(at, file), bytes: file!.bytes }));
  return { keep, alsoKeep: [starterUrl(url)] };
}

/** What the definitions need of the word list before it's in: the starter's (its size,
 *  hash and its own words' keys), then the word list's own keys. */
function earlyKeys(from: Starter): WordKeys {
  const own = starterKeys(from);
  return { size: own.size, keysHash: () => own.keysHash(), key: (id) => (index ? index.key(id) : own.key(id)) };
}

const hex = (bytes: Uint8Array | null) => (bytes ? Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") : "");

/** A suggestion's search answered from the starter, before the word list is in: false
 *  when the starter hasn't it (another search, other filters, or no starter). */
function fromStarter(data: Extract<ToWorker, { type: "search" }>): boolean {
  const query = normalize(data.query);
  const landing = starter && data.land ? landingFrom(starter, query, filterKey(filters)) : null;
  if (!landing) return false;
  waiting = null; // a newer search than any still waiting
  early = { seq: data.seq, query };
  later = [];
  scope.postMessage({
    type: "rows",
    seq: data.seq,
    query,
    from: landing.from,
    items: landing.items,
    known: landing.counts.total ?? landing.items.length,
    complete: true,
    counts: landing.counts,
    landAt: landing.landAt,
  });
  return true;
}

function sendStarterRows(seq: number, query: string, from: number, items: Suggestion[]) {
  const counts = starter!.pieces[query].counts;
  scope.postMessage({ type: "rows", seq, query, from, items, known: counts.total ?? 0, complete: true, counts });
}

/** The word list is in: answer what waited for it. */
function carryOn() {
  if (waiting) search(waiting);
  else if (early) {
    // The suggestion's list opened from the starter: the same list, now from the word list.
    matches = completer!.search(early.query, { filters });
    matchesFilters = filterKey(filters);
    matchesSeq = early.seq;
    for (const asked of later) if (asked.seq === matchesSeq) answer(asked);
    countInBackground(matches);
  }
  waiting = null;
  early = null;
  later = [];
  for (const asked of wordsLater) scope.postMessage({ type: "word", ask: asked.ask, suggestion: completer!.word(asked.text) });
  wordsLater = [];
}

/** Rows asked for, or a seek, in the current search. */
function answer(data: Extract<ToWorker, { type: "rows" | "seek" }>) {
  if (data.type === "rows") sendRows(data.from, data.to);
  else {
    const row = matches!.startOf(data.offset);
    sendRows(row, row + PAGE_SIZE, { offset: data.offset, row });
  }
}

/** The definitions for the word list (the core file at `url`, its layers beside it), or
 *  null when there's no core or it was built for another word list. A layer that's
 *  missing or doesn't fit is left out: the page shows what there is. `inPlace`: read
 *  each file a block at a time with Range requests, where the server sends exact
 *  ranges (the app's does: RangedAssets.java), else hold it whole. */
async function loadDefinitions(url: string, index: WordKeys, inPlace: boolean) {
  const [done, failed] = [found, lost];
  reloadDefinitions = () => {
    definitions = expectDefinitions();
    void loadDefinitions(url, index, inPlace);
  };
  // In a browser with a starter: from the device when it has them, else a block at a time.
  const fetched = (at: string) => (starter ? definitionsSource(versioned(at, starter.files[nameOf(at)]), starter.files[nameOf(at)]) : openSource(at, { inPlace }));
  let core: ByteSource | null, layers: (ByteSource | null)[];
  try {
    [core, ...layers] = await Promise.all([fetched(url), ...LAYERS.map((kind) => fetched(layerUrl(url, kind)))]);
  } catch (error) {
    console.warn("definitions out of reach:", error instanceof Error ? error.message : error);
    return failed(error); // not "no definitions" (no network, or the device's copy unreadable): the next question tries again
  }
  try {
    if (!core) throw new Error(`no ${url}`);
    const given: Partial<Record<Layer, ByteSource>> = {};
    LAYERS.forEach((kind, i) => layers[i] && (given[kind] = layers[i]));
    // Every file opened once, all at the same time; a layer that doesn't fit is left out.
    done(await DefinitionsFile.openFitting(core, index, given, (kind, why) => console.warn(`left out ${kind}:`, why instanceof Error ? why.message : why)));
  } catch (error) {
    console.warn("no definitions:", error instanceof Error ? error.message : error);
    if (error instanceof Unreachable) failed(error); // the next question tries again
    else done(null);
  }
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
    const { from, to } = landingWindow(row, PAGE_SIZE);
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
    counts: countsOf(m, matchesFilters),
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
    if (m.complete) scope.postMessage({ type: "counts", query: m.query, counts: countsOf(m, matchesFilters) });
    else countTimer = setTimeout(slice, 0);
  };
  countTimer = setTimeout(slice, 0);
}
