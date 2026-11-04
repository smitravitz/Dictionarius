# Handoff: where the project stands

Read this first in a new chat, then `.claude/CLAUDE.md`. Update it at the end of any
session that changes what's below (newest state only; history lives in git).

_Last updated: 2026-11-04, at v0.5.1._

## What it is

Dictionarius: an offline, open-source English dictionary that finds a word from any part
of it. TypeScript web app (no framework, Vite 7) wrapped for Android with Capacitor 8.
Search is an FM-index in a Web Worker; definitions are a brotli-blocked file. Data is
built from the English Wiktionary dump by `scripts/build_fm_index.py`.

- Data formats: `docs/index-format.md`, `docs/definitions-format.md`
- Decisions: `docs/adr/` (ADR-0005, layered data packs, is **Proposed**)
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

## Open items

1. ADR-0005 measurement gates: split content files, links as ids, block-at-a-time reading,
   then translations (French first).
2. The 102 MB installed vs 73.3 MB APK gap: get Android's storage breakdown (app/data/cache).
3. Whether the Android app should also wait behind the loading screen (currently no).
4. Start-screen copy "Or pick one from the bag below" may need updating for the two lanes.
5. Check the newer suggestion pieces in `web/examples.ts` against real word counts.
