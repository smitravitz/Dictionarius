#!/usr/bin/env python3
"""Build Dictionarily's headword index (an FM-index) from dictionary data.

Reads headwords from a Kaikki/Wiktionary JSONL dump, a JSON file, or a plain
word list; normalizes them exactly like the app's search box; and writes:

  <out>.bin          the index the app loads straight into typed arrays
  <out>.golden.json  expected answers computed by brute force, used by the
                     TypeScript loader's tests

The binary layout is specified in docs/index-format.md.

Every build verifies itself: it reads the .bin back and checks counts, prefix
ranges, exact lookups, locate, and extract against brute force. Any mismatch
stops the build with a non-zero exit code.

Usage:
  pip install -r scripts/requirements.txt
  python scripts/build_fm_index.py kaikki.org-dictionary-English.jsonl
  python scripts/build_fm_index.py words.txt --out /tmp/test --no-freq
"""

import argparse
import bisect
import gzip
import hashlib
import json
import os
import random
import re
import struct
import sys
import time
import unicodedata
import zlib

import numpy as np

try:
    import regex  # supports \p{Diacritic}, the same rule as the app's normalize()
except ImportError:
    sys.exit("missing dependency: pip install regex")
try:
    from pydivsufsort import divsufsort
except ImportError:
    sys.exit("missing dependency: pip install pydivsufsort")
try:
    import orjson  # optional, ~5x faster JSON parsing for the multi-GB Kaikki dump

    loads = orjson.loads
except ImportError:
    loads = json.loads


# ---------------------------------------------------------------- format ----

MAGIC = b"DICTFMv1"
FORMAT_VERSION = 1
NORM_ID = "nfd-strip-diacritic-lower-trim/v1"
FLAG_FREQ = 1
FLAG_HOT = 2
TERM, SEP = 0x00, 0x01
BLOCK_SHIFT, SUPER_SHIFT = 8, 16
HEADER = struct.Struct("<8s9I48sI")  # 96 bytes; the last u32 is numHot
DEFAULT_HOT = 200_000

# wordfreq scores a phrase or compound at about its rarest part's frequency
# ("of a" = 7.08 like "of"; "going-to" = 5.93 like "going"), and an affix at
# its stem's ("-something" = 5.81). Subtract this much Zipf per extra part (as
# wordfreq splits it: spaces and hyphens) and once more for an affix, so these
# rank below comparable single words.
PHRASE_PENALTY = 1.0
SECTION = struct.Struct("<8sII")  # name, offset, byteLength


def log(msg):
    print(msg, flush=True)


def human(nbytes):
    for unit in ("B", "KB", "MB", "GB"):
        if nbytes < 1024:
            return f"{nbytes:.1f} {unit}"
        nbytes /= 1024
    return f"{nbytes:.1f} TB"


# --------------------------------------------------------- normalization ----

# String.prototype.trim() removes exactly these: JS WhiteSpace + LineTerminator.
JS_WHITESPACE = (
    "\t\n\v\f\r   "
    + "".join(chr(c) for c in range(0x2000, 0x200B))
    + "    　﻿"
)
DIACRITIC = regex.compile(r"\p{Diacritic}")
CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def normalize(s):
    """Mirror of src/normalize.ts: NFD, strip diacritics, lowercase, trim."""
    folded = DIACRITIC.sub("", unicodedata.normalize("NFD", s))
    return folded.lower().strip(JS_WHITESPACE)


# ---------------------------------------------------------------- inputs ----


def open_any(path):
    if path.lower().endswith(".gz"):
        return gzip.open(path, "rb")
    return open(path, "rb")


def detect_format(path):
    p = path.lower()
    if p.endswith((".jsonl", ".jsonl.gz", ".ndjson", ".ndjson.gz")):
        return "kaikki"
    if p.endswith((".json", ".json.gz")):
        return "json"
    return "wordlist"


def read_kaikki(path, lang):
    """One JSON object per line; keep the top-level "word" of entries in `lang`."""
    words = []
    lines = 0
    started = time.time()
    with open_any(path) as f:
        for line in f:
            lines += 1
            if lines % 250_000 == 0:
                log(f"  {lines:,} lines read, {len(words):,} headwords ({time.time() - started:.0f}s)")
            line = line.strip()
            if not line:
                continue
            try:
                obj = loads(line)
            except ValueError:
                continue
            if not isinstance(obj, dict):
                continue
            if lang and obj.get("lang_code", lang) != lang:
                continue
            word = obj.get("word")
            if isinstance(word, str):
                words.append(word)
    log(f"  {lines:,} lines read")
    return words


def read_json(path):
    """A JSON object (headwords are its keys) or a list of strings / {"word": ...}."""
    with open_any(path) as f:
        data = json.load(f)
    if isinstance(data, dict):
        return list(data.keys())
    words = []
    for item in data:
        if isinstance(item, str):
            words.append(item)
        elif isinstance(item, dict) and isinstance(item.get("word"), str):
            words.append(item["word"])
    return words


def read_wordlist(path):
    with open_any(path) as f:
        return [line.decode("utf-8", "replace") for line in f]


# ------------------------------------------------------------ word table ----


def build_word_table(raw_words):
    """Group raw headwords by normalized key; sort keys bytewise (= word IDs)."""
    forms_by_key = {}
    skipped = 0
    for word in raw_words:
        word = word.strip(JS_WHITESPACE)  # same trim as search keys (Python's misses U+FEFF)
        if not word or CONTROL.search(word):
            skipped += 1
            continue
        key = normalize(word)
        if not key:
            skipped += 1
            continue
        forms_by_key.setdefault(key, set()).add(word)

    pairs = sorted((key.encode("utf-8"), key) for key in forms_by_key)
    encoded = [p[0] for p in pairs]
    keys = [p[1] for p in pairs]
    return encoded, keys, forms_by_key, skipped


# Zipf frequency per display form, filled in by word_frequencies().
FORM_ZIPF = {}


def display_forms(key, forms):
    """Display forms for a key, most frequent first (ties: the plain key, then
    code-point order), or None when the key itself is the only form."""
    if forms == {key}:
        return None
    return sorted(forms, key=lambda f: (-FORM_ZIPF.get(f, 0.0), f != key, f))


def word_frequencies(keys, forms_by_key):
    """Rank score x 100 per word: Zipf frequency (max over its display forms),
    minus PHRASE_PENALTY per extra part and for affixes. 0 = unknown; known
    words stay >= 1."""
    from wordfreq import tokenize, zipf_frequency

    freq = np.zeros(len(keys), dtype="<u2")
    started = time.time()
    for i, key in enumerate(keys):
        if i and i % 200_000 == 0:
            log(f"  frequencies: {i:,}/{len(keys):,} ({time.time() - started:.0f}s)")
        candidates = forms_by_key[key] | {key}
        for f in candidates:
            FORM_ZIPF[f] = zipf_frequency(f, "en")
        best = max(FORM_ZIPF[f] for f in candidates)
        if best > 0:
            extra = max(0, len(tokenize(key, "en")) - 1)
            if key.startswith("-") or key.endswith("-"):
                extra += 1  # an affix such as "-something" or "anti-"
            best = max(0.01, best - PHRASE_PENALTY * extra)
        freq[i] = round(best * 100)
    return freq


def rank_order(freq, k):
    """Word ids by rank: score descending, then id (alphabetical) ascending."""
    if freq is None:
        return np.arange(k, dtype=np.int64)
    return np.lexsort((np.arange(k), -freq.astype(np.int64)))


# -------------------------------------------------------------- FM-index ----


def build_fm(encoded):
    """Return (n, bwt, C, dense, sparse, SUPER, BLOCK, SOFF, SPOS)."""
    text = bytes([SEP]) + bytes([SEP]).join(encoded) + bytes([SEP, TERM])
    n = len(text)
    if n >= 2**31:
        sys.exit(f"indexed text too large for format v1: {n:,} bytes")

    t = np.frombuffer(text, dtype=np.uint8)
    sa = divsufsort(text)
    bwt = t[(sa.astype(np.int64) - 1) % n]
    del sa

    counts = np.bincount(bwt, minlength=256).astype(np.int64)
    C = np.zeros(257, dtype="<u4")
    C[1:] = np.cumsum(counts)

    # Dense (block rank tables) when cheaper than a position list: count > n/512.
    present = [c for c in range(256) if counts[c] > 0]
    dense = [c for c in present if counts[c] * 4 > (n >> BLOCK_SHIFT) * 2]
    sparse = [c for c in present if c not in dense]

    num_blocks = (n >> BLOCK_SHIFT) + 1
    num_supers = (n >> SUPER_SHIFT) + 1
    blocks_per_super_shift = SUPER_SHIFT - BLOCK_SHIFT
    SUPER = np.zeros((num_supers, len(dense)), dtype="<u4")
    BLOCK = np.zeros((num_blocks, len(dense)), dtype="<u2")
    cum = np.zeros(n + 1, dtype=np.uint32)
    for d, c in enumerate(dense):
        np.cumsum(bwt == c, dtype=np.uint32, out=cum[1:])  # cum[i] = occ(c, i)
        sup = cum[:: 1 << SUPER_SHIFT][:num_supers]
        blk = cum[:: 1 << BLOCK_SHIFT][:num_blocks]
        relative = blk - sup[np.arange(num_blocks) >> blocks_per_super_shift]
        if relative.max(initial=0) > 0xFFFF:
            sys.exit("internal error: block count overflows u16")
        SUPER[:, d] = sup
        BLOCK[:, d] = relative
    del cum

    positions = [np.flatnonzero(bwt == c).astype("<u4") for c in sparse]
    SOFF = np.zeros(len(sparse) + 1, dtype="<u4")
    SOFF[1:] = np.cumsum([len(p) for p in positions]) if positions else []
    SPOS = np.concatenate(positions) if positions else np.zeros(0, dtype="<u4")

    return n, text, bwt, C, dense, sparse, SUPER, BLOCK, SOFF, SPOS


# ---------------------------------------------------------------- writer ----


def align8(x):
    return (x + 7) & ~7


def write_index(path, n, k, flags, dense, sparse, sections, num_hot):
    table_end = HEADER.size + len(sections) * SECTION.size
    offset = align8(table_end)
    entries = []
    payloads = []
    for name, array in sections:
        data = np.ascontiguousarray(array).tobytes()
        entries.append((name, offset, len(data)))
        payloads.append((offset, data))
        offset = align8(offset + len(data))

    with open(path, "wb") as f:
        f.write(
            HEADER.pack(
                MAGIC, FORMAT_VERSION, flags, n, k, BLOCK_SHIFT, SUPER_SHIFT,
                len(dense), len(sparse), len(sections), NORM_ID.encode("ascii"), num_hot,
            )
        )
        for name, off, length in entries:
            f.write(SECTION.pack(name.encode("ascii"), off, length))
        pos = table_end
        for off, data in payloads:
            f.write(b"\x00" * (off - pos))
            f.write(data)
            pos = off + len(data)
    return entries


# ------------------------------------------------- reader (verification) ----


class IndexReader:
    """Independent reader of the .bin, implementing docs/index-format.md."""

    def __init__(self, buf):
        (magic, version, self.flags, self.n, self.k, self.bshift, self.sshift,
         D, S, nsec, norm_id, self.num_hot) = HEADER.unpack_from(buf, 0)
        if magic != MAGIC or version != FORMAT_VERSION:
            raise ValueError("bad magic/version")
        if norm_id.rstrip(b"\x00").decode("ascii") != NORM_ID:
            raise ValueError("normalization rule mismatch")
        sections = {}
        for i in range(nsec):
            name, off, length = SECTION.unpack_from(buf, HEADER.size + i * SECTION.size)
            if off % 8 or off + length > len(buf):
                raise ValueError(f"bad section {name!r}")
            sections[name.rstrip(b"\x00").decode("ascii")] = (off, length)

        def view(name, dtype):
            off, length = sections[name]
            dt = np.dtype(dtype)
            return np.frombuffer(buf, dtype=dt, count=length // dt.itemsize, offset=off)

        self.C = [int(x) for x in view("C", "<u4")]
        self.bwt = view("BWT", np.uint8)
        self.dense_index = {int(c): d for d, c in enumerate(view("DSYM", np.uint8))}
        self.D = D
        self.SUPER = view("SUPER", "<u4").reshape(-1, D) if D else None
        self.BLOCK = view("BLOCK", "<u2").reshape(-1, D) if D else None
        soff = view("SOFF", "<u4")
        spos = view("SPOS", "<u4")
        self.sparse = {
            int(c): spos[soff[s]:soff[s + 1]] for s, c in enumerate(view("SSYM", np.uint8))
        }
        self.freq = view("FREQ", "<u2") if self.flags & FLAG_FREQ else None
        self.vids = view("VIDS", "<u4")
        self.voff = view("VOFF", "<u4")
        self.vblob = view("VBLOB", np.uint8)
        self.hot = view("HOTK", np.uint8) if self.flags & FLAG_HOT else None

    def hot_keys(self):
        """Keys of the top-ranked words, in rank order."""
        if self.hot is None:
            return []
        parts = self.hot.tobytes().split(bytes([SEP]))
        if parts[-1] != b"" or len(parts) - 1 != self.num_hot:
            raise ValueError("HOTK does not hold numHot SEP-terminated keys")
        return parts[:-1]

    def occ(self, c, i):
        d = self.dense_index.get(c)
        if d is not None:
            b = i >> self.bshift
            base = int(self.SUPER[i >> self.sshift, d]) + int(self.BLOCK[b, d])
            start = b << self.bshift
            if i > start:
                base += int(np.count_nonzero(self.bwt[start:i] == c))
            return base
        pos = self.sparse.get(c)
        return 0 if pos is None else int(np.searchsorted(pos, i, side="left"))

    def lf(self, row):
        c = int(self.bwt[row])
        return self.C[c] + self.occ(c, row)

    def range(self, pattern):
        lo, hi = 0, self.n
        for c in reversed(pattern):
            lo = self.C[c] + self.occ(c, lo)
            hi = self.C[c] + self.occ(c, hi)
            if lo >= hi:
                return 0, 0
        return lo, hi

    def prefix(self, q):
        lo, hi = self.range(bytes([SEP]) + q)
        base = self.C[SEP] + 1
        return (lo - base, hi - base) if hi > lo else None

    def exact(self, q):
        lo, hi = self.range(bytes([SEP]) + q + bytes([SEP]))
        return lo - self.C[SEP] - 1 if hi - lo == 1 else None

    def locate(self, row):
        while self.bwt[row] != SEP:
            row = self.lf(row)
        return self.occ(SEP, row) - 1

    def extract(self, word_id):
        row = self.C[SEP] + (0 if word_id == self.k - 1 else word_id + 2)
        out = bytearray()
        while self.bwt[row] != SEP:
            out.append(int(self.bwt[row]))
            row = self.lf(row)
        return bytes(reversed(out))

    def display(self, word_id):
        j = bisect.bisect_left(self.vids, word_id)
        if j < len(self.vids) and self.vids[j] == word_id:
            blob = self.vblob[self.voff[j]:self.voff[j + 1]].tobytes()
            return blob.decode("utf-8").split("\x00")
        return None


# ------------------------------------------------ brute force & checking ----


def count_overlapping(text, q):
    return sum(1 for _ in re.finditer(b"(?=" + re.escape(q) + b")", text))


def brute_prefix(encoded, q):
    lo = bisect.bisect_left(encoded, q)
    hi = bisect.bisect_left(encoded, q + b"\xff")  # UTF-8 never contains 0xFF
    return (lo, hi) if hi > lo else None


def brute_exact(encoded, q):
    i = bisect.bisect_left(encoded, q)
    return i if i < len(encoded) and encoded[i] == q else None


def random_substring(rng, keys, max_chars):
    key = rng.choice(keys)
    length = rng.randint(1, min(max_chars, len(key)))
    start = rng.randint(0, len(key) - length)
    return key[start:start + length]


class Checker:
    def __init__(self):
        self.passed = 0

    def equal(self, what, got, expected):
        if got != expected:
            sys.exit(f"VERIFY FAILED: {what}: got {got!r}, expected {expected!r}")
        self.passed += 1


def verify(reader, text, encoded, keys, forms_by_key, freq, rng, py_order):
    check = Checker()
    # Hot list = keys of the first numHot words in rank order. py_order is an
    # independent sort (Python's sorted, not numpy's lexsort used to build it).
    check.equal("hot keys in rank order", reader.hot_keys(),
                [encoded[i] for i in py_order[: reader.num_hot]])
    k = len(encoded)
    # Non-ASCII words are rare in English data but exercise the multi-byte and
    # sparse-symbol paths, so always check a batch of them on top of the sample.
    non_ascii = [i for i, w in enumerate(encoded) if max(w) >= 0x80]
    sample = rng.sample(range(k), min(300, k)) + rng.sample(non_ascii, min(200, len(non_ascii)))

    for _ in range(min(40, len(non_ascii))):  # mid-word queries around a non-ASCII char
        key = keys[rng.choice(non_ascii)]
        at = next(j for j, ch in enumerate(key) if ord(ch) >= 0x80)
        q = key[max(0, at - rng.randint(0, 1)): at + rng.randint(1, 2)].encode("utf-8")
        lo, hi = reader.range(q)
        check.equal(f"count({q!r})", hi - lo, count_overlapping(text, q))
        if hi - lo <= 400:
            got = sorted({reader.locate(row) for row in range(lo, hi)})
            check.equal(f"locate({q!r})", got, [i for i, w in enumerate(encoded) if q in w])

    for wid in sample:
        check.equal(f"extract({wid})", reader.extract(wid), encoded[wid])
        check.equal(f"exact({keys[wid]!r})", reader.exact(encoded[wid]), wid)
        check.equal(f"display({wid})", reader.display(wid),
                    display_forms(keys[wid], forms_by_key[keys[wid]]))
        if freq is not None:
            check.equal(f"freq({wid})", int(reader.freq[wid]), int(freq[wid]))
    for _ in range(100):  # mutated non-words
        q = (rng.choice(keys) + rng.choice("qzx")).encode("utf-8")
        check.equal(f"exact({q!r})", reader.exact(q), brute_exact(encoded, q))

    for _ in range(300):
        key = rng.choice(keys)
        q = key[: rng.randint(1, min(5, len(key)))].encode("utf-8")  # a real prefix
        check.equal(f"prefix({q!r})", reader.prefix(q), brute_prefix(encoded, q))

    located = 0
    for _ in range(150):
        q = random_substring(rng, keys, 7).encode("utf-8")
        lo, hi = reader.range(q)
        check.equal(f"count({q!r})", hi - lo, count_overlapping(text, q))
        if hi - lo <= 400 and located < 40:
            located += 1
            got = sorted({reader.locate(row) for row in range(lo, hi)})
            expected = [i for i, w in enumerate(encoded) if q in w]
            check.equal(f"locate({q!r})", got, expected)
    return check.passed


# ----------------------------------------------------------------- golden ---

NORMALIZATION_SAMPLES = [
    "Résumé", "naïve", "Ångström", "İstanbul", "ΟΔΟΣ", "Straße", "œuvre",
    "Hawaiʻi", "C#", "  padded ", "﻿bom", "ice cream", "Ǆemal",
]


def golden(reader, text, encoded, keys, forms_by_key, freq, rng, bin_sha256, py_order):
    k = len(encoded)
    out = {
        "file": {"sha256": bin_sha256, "version": FORMAT_VERSION, "normId": NORM_ID,
                 "n": reader.n, "numWords": k, "numHot": reader.num_hot},
        "normalize": [[s, normalize(s)] for s in NORMALIZATION_SAMPLES],
        "exact": [], "prefix": [], "substring": [], "extract": [], "display": [], "freq": [],
        "rank": [],
    }
    # Word ids at sample positions of the rank order (score desc, id asc),
    # including both sides of the hot-list boundary.
    ranks = {0, 1, 2, k - 1} | set(rng.sample(range(k), min(12, k)))
    if 0 < reader.num_hot < k:
        ranks |= {reader.num_hot - 1, reader.num_hot}
    out["rank"] = [{"rank": r, "id": int(py_order[r])} for r in sorted(ranks)]
    variant_ids = [i for i in range(k) if display_forms(keys[i], forms_by_key[keys[i]])]
    out["normalize"] += [[f, keys[i]] for i in rng.sample(variant_ids, min(10, len(variant_ids)))
                         for f in [rng.choice(sorted(forms_by_key[keys[i]]))]]

    for i in rng.sample(range(k), min(15, k)):
        out["exact"].append({"q": keys[i], "id": i})
    for _ in range(5):
        q = rng.choice(keys) + "qzx"
        out["exact"].append({"q": q, "id": brute_exact(encoded, q.encode("utf-8"))})

    for length in (1, 1, 2, 2, 3, 3, 4, 5, 6, 8):
        pool = [w for w in rng.sample(keys, min(50, k)) if len(w) >= length] or keys
        q = rng.choice(pool)[:length]
        r = brute_prefix(encoded, q.encode("utf-8"))
        out["prefix"].append({"q": q, "start": r[0] if r else None,
                              "count": (r[1] - r[0]) if r else 0})

    for max_chars in (1, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 8):
        q = random_substring(rng, keys, max_chars)
        qb = q.encode("utf-8")
        ids = [i for i, w in enumerate(encoded) if qb in w]
        entry = {"q": q, "occurrences": count_overlapping(text, qb), "wordCount": len(ids)}
        if len(ids) <= 50:
            entry["wordIds"] = ids
        out["substring"].append(entry)
    out["substring"].append({"q": "qzxqzx", "occurrences": 0, "wordCount": 0, "wordIds": []})

    for i in sorted(rng.sample(range(k), min(12, k)) + [0, k - 1]):
        out["extract"].append({"id": i, "word": keys[i]})
    for i in rng.sample(variant_ids, min(10, len(variant_ids))):
        out["display"].append({"id": i, "forms": display_forms(keys[i], forms_by_key[keys[i]])})
    if freq is not None:
        for i in rng.sample(range(k), min(10, k)):
            out["freq"].append({"id": i, "zipf100": int(freq[i])})
    return out


# ------------------------------------------------------------------ main ----


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("input", help="Kaikki .jsonl[.gz], .json, or word list (.txt)")
    ap.add_argument("--format", choices=["auto", "kaikki", "json", "wordlist"], default="auto")
    ap.add_argument("--out", default="dist/headwords", help="output path without extension")
    ap.add_argument("--lang", default="en", help="Kaikki lang_code to keep (default: en)")
    ap.add_argument("--limit", type=int, help="use only the first N headwords (quick tests)")
    ap.add_argument("--no-freq", action="store_true", help="skip word frequencies")
    ap.add_argument("--hot", type=int, default=DEFAULT_HOT,
                    help=f"top-ranked words in the fast mid-word list (default {DEFAULT_HOT:,}; 0 = none)")
    ap.add_argument("--seed", type=int, default=1, help="seed for verification samples")
    args = ap.parse_args()

    started = time.time()
    fmt = detect_format(args.input) if args.format == "auto" else args.format
    log(f"reading {args.input} ({fmt})")
    if fmt == "kaikki":
        raw = read_kaikki(args.input, args.lang)
    elif fmt == "json":
        raw = read_json(args.input)
    else:
        raw = read_wordlist(args.input)
    if args.limit:
        raw = raw[: args.limit]

    encoded, keys, forms_by_key, skipped = build_word_table(raw)
    k = len(keys)
    if k == 0:
        sys.exit("no headwords found")
    n_variants = sum(1 for key in keys if display_forms(key, forms_by_key[key]))
    log(f"  {len(raw):,} headwords read, {skipped:,} skipped, {k:,} unique search keys, "
        f"{n_variants:,} with display forms")

    freq = None
    if not args.no_freq:
        try:
            freq = word_frequencies(keys, forms_by_key)
        except ImportError:
            log("  wordfreq not installed, skipping frequencies (pip install wordfreq)")

    log("building FM-index")
    n, text, bwt, C, dense, sparse, SUPER, BLOCK, SOFF, SPOS = build_fm(encoded)

    vids, voff, blobs = [], [0], []
    for i, key in enumerate(keys):
        forms = display_forms(key, forms_by_key[key])
        if forms:
            blob = b"\x00".join(f.encode("utf-8") for f in forms)
            vids.append(i)
            blobs.append(blob)
            voff.append(voff[-1] + len(blob))

    sections = [
        ("C", C),
        ("BWT", bwt),
        ("DSYM", np.array(dense, dtype=np.uint8)),
        ("SUPER", SUPER),
        ("BLOCK", BLOCK),
        ("SSYM", np.array(sparse, dtype=np.uint8)),
        ("SOFF", SOFF),
        ("SPOS", SPOS),
    ]
    if freq is not None:
        sections.append(("FREQ", freq))
    sections += [
        ("VIDS", np.array(vids, dtype="<u4")),
        ("VOFF", np.array(voff, dtype="<u4")),
        ("VBLOB", np.frombuffer(b"".join(blobs), dtype=np.uint8)),
    ]

    # Hot list: keys of the top-ranked words, in rank order, each ending in SEP.
    # The app scans it with a plain string search, so mid-word hits come out
    # already ranked; the ids are recomputed in the app from FREQ.
    num_hot = min(max(args.hot, 0), k)
    if num_hot:
        hot_ids = rank_order(freq, k)[:num_hot]
        hot_blob = b"".join(encoded[i] + bytes([SEP]) for i in hot_ids)
        sections.append(("HOTK", np.frombuffer(hot_blob, dtype=np.uint8)))

    flags = (FLAG_FREQ if freq is not None else 0) | (FLAG_HOT if num_hot else 0)
    out_dir = os.path.dirname(os.path.abspath(args.out))
    os.makedirs(out_dir, exist_ok=True)
    bin_path = args.out + ".bin"
    entries = write_index(bin_path, n, k, flags, dense, sparse, sections, num_hot)
    with open(bin_path, "rb") as f:
        buf = f.read()
    sha = hashlib.sha256(buf).hexdigest()

    log("verifying against brute force")
    reader = IndexReader(buf)
    rng = random.Random(args.seed)
    score = (lambda i: -int(freq[i])) if freq is not None else (lambda i: 0)
    py_order = sorted(range(k), key=lambda i: (score(i), i))
    passed = verify(reader, text, encoded, keys, forms_by_key, freq, rng, py_order)
    log(f"  OK: {passed:,} checks passed")

    golden_path = args.out + ".golden.json"
    data = golden(reader, text, encoded, keys, forms_by_key, freq,
                  random.Random(args.seed + 1), sha, py_order)
    with open(golden_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    gz = len(zlib.compress(buf, 6))
    log("")
    log(f"{'headwords (search keys)':<26}{k:>14,}")
    log(f"{'indexed text n':<26}{n:>14,} bytes")
    log(f"{'alphabet':<26}{len(dense) + len(sparse):>14} byte values "
        f"({len(dense)} dense, {len(sparse)} sparse)")
    for name, _, length in entries:
        log(f"  {name:<24}{human(length):>14}")
    log(f"{'total .bin':<26}{human(len(buf)):>14}")
    log(f"{'gzip transfer (approx)':<26}{human(gz):>14}")
    log(f"{'sha256':<26}{sha}")
    log(f"wrote {bin_path}")
    log(f"wrote {golden_path}")
    log(f"done in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
