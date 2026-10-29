# ADR-0002: The app never connects; more definitions arrive as a file the user brings

- **Status:** Superseded by [ADR-0004](0004-all-definitions-bundled.md) (never accepted): every definition is bundled, so there is no Tail to bring
- **Date:** 2026-10-28
- **Deciders:** project owner
- **Supersedes in part:** [ADR-0001](0001-frequency-tiered-gloss-storage.md), on how the **Tail**
  reaches the device (its On-demand fetch and in-app Pre-download). The tiering itself stands:
  a **Core** inside the app, and a **Tail** for the rest.
- **Related:** `privacy.toml`, `scripts/audit_privacy.py`, commit 40d9ad0 (no permissions)

## Context and problem statement

ADR-0001 fetches Tail glosses from a static host when a rare word is opened, or all at once on
request. Since commit 40d9ad0 the Android app requests no permissions at all, `privacy.toml`
allows no hosts, and the page's Content-Security-Policy refuses every other origin. CI fails
any build that asks for a permission. The two can't both hold.

The owner prefers an app that never connects. A network download would be acceptable only if
the app asked for no permission at install and asked for internet access only when the user
tapped a download button. Android can't do that: INTERNET is a *normal* permission, granted
when the app is installed if the manifest declares it, and never requested at runtime. Any build
that declares it lists network access from the first launch. On iOS no network permission
exists at all, so "only when asked" could only be enforced in our own code.

## Decision drivers

- No permissions, on any build: nothing a store listing, F-Droid or a GrapheneOS user sees as
  network access.
- Every word stays searchable offline from first run (ADR-0001's guarantee, unchanged).
- A user who wants every definition can still get them, without an account or a server we run.
- Works the same through F-Droid, Obtainium and a direct APK.

## Considered options

1. **On-demand fetch (ADR-0001 as written).** Needs INTERNET from install. Rejected.
2. **A second "online" build with INTERNET.** Doubles releases, and the online build still has
   the permission from install. Rejected.
3. **Offline only, with a data pack the user brings.** The Tail ships as one file. Chosen.

## Decision

- The app never declares INTERNET, and `network.hosts` in `privacy.toml` stays empty.
- The **Core** (the Headword index, plus definitions for the most-used words once they're built)
  ships inside the app.
- The **Tail** is published as a **Data pack**: one file attached to a GitHub release, its
  SHA-256 pinned in the repository like `data/headwords.sha256`.
- In the app, **Get the full dictionary** opens the Data pack's download link in the user's
  browser. It's a link the user taps; the browser does the download, and the app connects to
  nothing. `github.com` is already among `privacy.toml`'s links.
- **Import a data pack** opens the system file picker (the Storage Access Framework on Android,
  the document picker on iOS, `<input type=file>` on the web). No storage permission is needed.
  The app checks the file's checksum, then copies it into its own storage.
- Both steps also work by hand: download the file anywhere, then import it. This is the manual
  path that apps like Whisper+ on F-Droid offer.

## Consequences

- Good: the app has no permissions and contacts no servers, so the privacy budget holds and
  F-Droid has nothing to flag.
- Good: one build for every store; the data's provenance is checkable (pinned checksum).
- Bad: getting the Tail takes two taps and a trip to the browser, not one tap.
- Bad: definitions don't arrive word by word as you open them; a pack is all or nothing (or a
  few frequency bands, if one file proves too big).
- ADR-0001's claim "rare definitions fetch on demand" no longer applies. The app's claim becomes
  "works fully offline; add the full dictionary from a file".

## Open questions

1. One Tail file, or a few frequency bands, once definitions are measured.
2. Data pack format: reuse the index's sectioned layout or a separate one.
3. Whether the web build (a PWA) gets the same import flow, or loads the Tail from its own origin.
