# ADR-0008: The web app starts from a small starter; the rest loads behind it and stays on the device

- **Status:** Accepted; built 2026-11-10
- **Date:** 2026-11-10
- **Deciders:** project owner
- **Builds on:** [ADR-0005](0005-layered-data-packs.md) (definitions read a block at a time).
  Replaces the browser's "show nothing until everything is in" start (`web/loader.ts`, v0.5).
- **Related:** `src/starter.ts`, `tools/web-data.ts`, `tools/make-starter.ts`,
  `web/search-worker.ts`, `web/data-files.ts`, `web/data-cache.ts`, `web/data-worker.ts`,
  `web/sw.js`, `e2e/start.spec.ts`, `e2e/built/offline.spec.ts`

## Context and problem statement

In a browser, the loading screen waited for the word list (32.8 MB) and every definition
file (about 57 MB) before showing anything. Measured on the full word list (1,357,380 keys):
parsing the index takes **2 ms** and the search code about 50 ms, so the whole wait was the
download. The person waited for ~90 MB before they could touch anything, every first visit.

## Decision drivers

- Something useful on screen in the time a small file takes, not ~90 MB.
- No answer that changes after it shows: what the page shows early must be the word list's
  own answer, not an approximation.
- One search pipeline: no second ranking written for the early answers.
- Offline after one visit, as the app is; private (no new servers, `privacy.toml` unchanged).
- The Android app unchanged: it reads its files from the phone in a moment.

## Considered options

1. **A starter, the rest behind it** (chosen): a small file per word list, made at build time
   by the app's own search code, answers the start screen; everything else loads behind it.
2. **Tiered word lists** (a common-words index first, the full one later): searchable at
   once, but counts and the frequency graph would change when the full list arrives, and the
   index format and builder would need a second list. Kept in reserve if the wait for typed
   searches is still too long.
3. **Splitting the index by first letter**: doesn't work; a search finds a piece anywhere in
   a word, so every search needs every word.
4. **A search server**: breaks offline use and the privacy budget.

## Decision

- **The starter** (`<list>.starter.json`, ~93 KB gzipped for the full list): the word count,
  the filters on offer, and each start-screen suggestion's counts and the rows around 3 of its
  landing spots, worked out with the default filters; the word list's keys hash; and each data
  file's SHA-256 and size. `tools/web-data.ts` makes it with the app's own modules (loaded
  through Vite's `runnerImport`, so the search code is the app's, not a copy), at build time
  for the web (`DICTIONARIUS_WEB=1`, set by `pages.yml`), and as the dev server starts.
- **The loading screen waits for the starter only.** The suggestions open from it at once,
  landed where the word list would land them; a typed search says "Loading the word list…
  N%" until the list is in, then answers. What the starter can't answer (other filters, rows
  beyond its landings, links) waits for the list and is answered then.
- **The word list comes gzipped** (`<list>.bin.gz`, 13.7 MB instead of 32.6 MB), unpacked as
  it streams (`DecompressionStream`). A server that sends the `.gz` with
  `Content-Encoding: gzip` gets it unpacked by the browser; the first two bytes tell which.
- **Definitions are read a block at a time** in a browser too (Range requests, as in the app),
  from the moment the starter is in: the starter's keys hash and its own words' keys are all
  the definitions need until the list arrives (`WordKeys` in `src/definitions.ts`).
- **A loading channel of its own.** Once the word list is in, a second worker
  (`web/data-worker.ts`) keeps every data file on the device (Cache Storage), one at a time at
  low fetch priority, so a word's page is never held up by it; reads switch to the device's
  copy as soon as it's there. A thin bar under the title says how far along it is and how good
  the connection is, judged from the download's own speed (`web/keep-on-device.ts`,
  `web/connection.ts`: fast from 1 MB/s, slow from 100 kB/s, very slow below, none after 8 s
  with nothing in or with the browser offline; nothing is sent anywhere to measure it). Once
  it's all in, "Downloaded · works offline", then it fades out over 5 s. With no connection it
  stays, and carries on as soon as the browser says it's back (or every 15 s). It sits over the
  page, so nothing moves for it; it only shows while something is downloading. Settings says
  only how it ended ("Saved on this device: works offline."). Skipped with Data Saver on, or
  without room. (Amended 2026-11-12: the progress was a line in Settings.)
- **Versions by hash**: data files are fetched as `<file>?v=<sha256 prefix>`, so neither the
  browser's cache nor the device's copy can serve an old file for a new one; old versions are
  let go after a new set is kept. The starter is always asked for fresh (the device's copy
  only offline).
- **The page itself offline**: the web build has a service worker (`sw.js`) that keeps the
  page's HTML, scripts, styles and fonts (about 0.8 MB) and serves them when there's no
  network. The data files aren't its business. Never registered in the app or in development.

## Consequences

- First visit: the app shows after the starter; suggestions, the tour's first step, peeks
  and word pages work at once; a typed search waits for 13.7 MB instead of ~90 MB.
- Later visits, online or not: everything from the device.
- The Pages site carries the gzipped copy too (+13.7 MB per word list); the APK doesn't.
- Two servers' behaviours matter now (Range, Content-Encoding, Vary): the production build is
  tested as Pages serves it (`npm run test:e2e:built`, in CI).
- On the web, a definitions file's device copy is read through Blob slices. ADR-0005's note
  that a Blob's slices don't save memory applies to Blobs built in memory; Cache Storage's are
  backed by the disk in Chromium (🟡 not measured here). The old web start held every file
  whole in memory, so this is no worse either way.

## Evidence

- Index parse 2 ms, search code 47 ms, 34 suggestions × 3 landings counted in 783 ms (Node,
  full list); starter 850 KB as JSON, 93 KB gzipped; index 32.6 MB → 13.7 MB gzipped.
- `test/starter.test.ts`: the starter's landings, rows and counts equal the word list's own,
  read back through JSON. `test/web-build.test.ts`: the web build has the starter and the
  gzipped copy, named by hash; the app's build doesn't.
- `e2e/start.spec.ts`: the app shows and a suggestion opens landed with the word list held
  back; a typed search shows progress, then its words; a second visit downloads no data.
  `e2e/built/offline.spec.ts`: the published build opens and works offline after one visit.

## Open questions

- Confirm on GitHub Pages that Range requests come back exact (206 with the asked range):
  if not, a word's page waits for its whole definitions file the first time (it still works).
- If typed searches on a first visit still wait too long on slow connections: option 2.
