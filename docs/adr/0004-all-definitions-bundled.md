# ADR-0004: Every definition ships inside the app, packed with brotli

- **Status:** Accepted
- **Date:** 2026-10-28
- **Deciders:** project owner
- **Supersedes:** [ADR-0001](0001-frequency-tiered-gloss-storage.md)'s split into a bundled
  **Core** and a fetched **Tail**, and with it [ADR-0002](0002-offline-only-data-packs.md)
  (proposed, never accepted), which only decided how the Tail would arrive. There is no Tail.
- **Related:** `docs/definitions-format.md`, `scripts/definitions.py`, `src/definitions.ts`,
  `bench/definitions_packing.py`, `scripts/sample_definitions.py`

## Context and problem statement

The app found words but couldn't define them. ADR-0001 planned definitions for the most common
~50k words inside the app and the rest fetched or imported; ADR-0002 then ruled out fetching (the
app has no network permission) in favour of a data pack the user imports. The owner chose
instead to bundle every definition, and to make that as small as it can reasonably be.

## Decision drivers

- Every word defined offline from the first run, with no permission, download or import.
- Size: the APK is the one cost the user pays.
- Showing one word (an entry, a peek) unpacks only a small part of the file.
- Decoding inside the WebView without loosening the Content-Security-Policy (no WebAssembly)
  and with a small, freely licensed dependency.

## Considered options

Measured on a 5% sample of the Wiktionary dump (every 20th English word, by hash; 75,211 of
1,499,161 entries), scaled to the whole dictionary. Definitions only, then with extras:

| Packing, 4,096 words per block | Size | Decode / block (Node) | Decoder |
|---|---|---|---|
| JSON, zlib (the browser's own) | 46.8 MB | ~3 ms | built in |
| Compact, zlib | 36.8 MB | ~3 ms | built in |
| Compact, zstd-19 | 31.3 MB | ~3 ms | fzstd, 8 KB, MIT |
| Compact, zstd-19 + trained dictionary | 29.5 MB | — | needs WebAssembly (no pure-JS decoder takes a dictionary) |
| **Compact, brotli-11** | **29.4 MB** | **~7 ms** | **brotli (npm), pure JS, MIT** |
| Compact as one stream (no random access), brotli/xz | ~26 MB | — | lower bound |

*Compact* (`docs/definitions-format.md`): 40% of meanings are links ("plural of X"), and 64
templates cover 96% of them, so a link gloss is a template number and a word; written forms
equal to the search key and word classes are numbers. Raw size falls from 217 MB to 121 MB.

Smaller blocks cost size (brotli: 33.1 MB at 256, 30.9 MB at 1,024); bigger ones cost time per
word shown. Extras, compact brotli at 4,096: pronunciation +1.6 MB, etymology +9.4 MB (once
Wiktionary's "Etymology tree" diagrams are dropped: 11% of etymologies, but 44% of their text,
and unreadable as text), examples +51 MB (more than the definitions themselves). Everything
bundled: **40.4 MB**.

## Decision

- Every word's definitions are in `<index>.definitions.bin`, beside the index, read by word id.
- Compact packing, brotli quality 11, 4,096 word ids per block; the reader unpacks a block once
  and keeps the 8 most recent.
- Bundled: word class, meanings (gloss, usage labels, a safe-search flag), the words a plural or
  spelling links to, **Wiktionary's own links inside each meaning** (a design target: as on
  Wiktionary, words in a definition open their entries), pronunciation (IPA) and etymology.
  Not bundled: examples.
- The file carries the index's key-list hash (`KEYHASH`); a mismatched pair is refused.
- Releases carry both files in one `data-<sum>` release; `data/headwords.sha256` lists both.

## Consequences

- Estimated APK about 55 MB: index ~13 MB once zipped, definitions ~40 MB (already compressed),
  plus the app. Real blocks hold neighbouring words, which share more than the sample's, so the
  real file should come out smaller.
- The definitions need the dump: a rebuild from the word list and labels cache has no
  definitions.
- The builder needs `brotli` (pip); the app adds the `brotli` npm package (~0.9 MB of JS
  including brotli's built-in dictionary, ~0.25 MB zipped).
- Building them: the sample (5%) builds in 29 s at 230 MB peak memory, definitions included.
- Showing an uncached word unpacks about 600 KB: ~7–10 ms on a desktop CPU, perhaps 3–5× that
  on a phone; the peek appears only after a 420 ms hold anyway.
- ADR-0002's import flow, data-pack hosting and checksum-pinned packs are not needed.

## Evidence

`bench/definitions_packing.py` on the sample (`scripts/sample_definitions.py`). The sample was
taken before links were kept, so their cost is measured on the first full build.

## Open questions

- Links' size, and the real file's size, from the first full build.
- Examples, if wanted later, as their own optional file (+51 MB).
