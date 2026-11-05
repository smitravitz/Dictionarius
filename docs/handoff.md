# Handoff: where the project stands

Read this first in a new chat, then `.claude/CLAUDE.md`. Update it at the end of any
session that changes what's below (newest state only; history lives in git).

_Last updated: 2026-11-05, at v0.5.1._

## What it is

Dictionarius: an offline, open-source English dictionary that finds a word from any part
of it. TypeScript web app (no framework, Vite 7) wrapped for Android with Capacitor 8.
Search is an FM-index in a Web Worker; definitions are a brotli-blocked file. Data is
built from the English Wiktionary dump by `scripts/build_fm_index.py`.

- Data formats: `docs/index-format.md`, `docs/definitions-format.md`
- Decisions: `docs/adr/` (ADR-0005, layered data packs: Proposed, its step 1 built;
  ADR-0006, letter and position conditions as bitmaps: Proposed)
- Build, test, release: `docs/development.md`

## Where things are

| Path | What |
|---|---|
| `src/` | Search engine, definitions reader, filters (runs in the worker; unit-tested) |
| `web/` | The page: `main.ts`, the worker `search-worker.ts`, gestures, loading screen `loader.ts` |
| `scripts/` | Python data pipeline, `setup-release.sh`, privacy audit |
| `e2e/` | Playwright tests (desktop + phone) against `test/fixtures` sample data |
| `android/` | Capacitor Android shell, `EdgeGesturesPlugin.java` |
| `.github/workflows/` | `ci.yml`, `release.yml` (tag → signed APK), `pages.yml` (web app on Pages) |

## Shipping

- Release: `git tag -a vX.Y.Z -m "notes" && git push origin vX.Y.Z` (the owner pushes tags;
  sessions can't). Builds the signed APK, publishes the GitHub release, then starts
  `pages.yml` on main to put that version at https://smitravitz.github.io/Dictionarius/.
- Republish Pages without a release: Actions → Pages → Run workflow.
- Data changes: rebuild with the pipeline, then `bash scripts/setup-release.sh …` uploads
  the files as a `data-<sum>` release and updates `data/headwords.sha256`; commit that.

## Rules that always apply

- Never put a link to a Claude chat or session in anything published (see `.claude/CLAUDE.md`).
  Commit footer: only `Co-Authored-By: …`. CI fails on a session link.
- Offline and private: no network permission, no trackers; `privacy.toml` is the budget.
- Commit bug fixes as commits; don't bump versions or tag unless asked.
- Measure before claiming size or speed (ADR-0005's gates).

## State

- **v0.5.1** released (APK 73.3 MB at v0.5.0: definitions 56.8 MB, index 12.9 MB).
- Web app on Pages: a browser shows a loading screen (book turning pages) until the index
  and all definitions are in; the Android app skips it and loads definitions after start.
- `/dictionarius/` (lowercase) needs the owner's user-site repo `smitravitz.github.io` with
  a redirecting `404.html` (given to the owner; not confirmed set up).

## Before the next release (data format 3)

`main` reads definitions format 3 (a core file plus examples, etymology and pronunciation
layers, ADR-0005); the pinned data (`data/headwords.sha256`) is still format 2. The release
workflow refuses to build until they match. Once, on the owner's computer:

```bash
git pull && pip install -r scripts/requirements.txt
python scripts/upgrade_definitions.py dist/headwords.definitions.bin   # ~5 min; or rebuild from the dump
(cd dist && shasum -a 256 headwords.bin headwords.definitions.bin headwords.examples.bin \
  headwords.etymology.bin headwords.pronunciation.bin) > data/headwords.sha256
git commit -m "Pin format-3 data" data/headwords.sha256 && git push
bash scripts/setup-release.sh dist/headwords.bin
```

Then tag (v0.6.0: a data format change).

## Open items

1. ADR-0005: blocks read from storage (gate not met: Blobs only move memory; Capacitor's
   Range handling is broken; needs a native asset-range reader or a fixed path handler),
   then links and "plural of" as ids, then translations (French first). A core-only
   APK flavour is now possible (33.8 MB of definitions instead of 56.9).
2. The 102 MB installed vs 73.3 MB APK gap: get Android's storage breakdown (app/data/cache).
3. Whether the Android app should also wait behind the loading screen (currently no).
   On the phone, also measure memory with format 3 (`adb shell dumpsys meminfo
   io.github.smitravitz.dictionarius`): desktop Chromium shows about 30 MB more than
   format 2, unexplained (ADR-0005, Evidence).
4. Start-screen copy "Or pick one from the bag below" may need updating for the two lanes.
5. Check the newer suggestion pieces in `web/examples.ts` against real word counts.
6. ADR-0006 gates: the `LTRS` letter column first, then the positions layer and the
   letter keyboard / pattern field.
