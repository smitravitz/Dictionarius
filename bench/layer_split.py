#!/usr/bin/env python3
"""ADR-0005's first gate: how big is each kind of definition content on its own?

Reads a real version-2 definitions file (everything in one, before v0.6) block by
block, splits every word's packed line into the four content kinds ADR-0005
names, and compresses each kind's blocks the way the builder does (brotli
quality 11, window 22, 4,096 words a block):

  core           forms, word classes, meanings: gloss, labels, linked words,
                 links, safe-search flag; which etymology and pronunciation
                 each entry has (as numbers)
  examples       one short example per meaning, in reading order
  etymology      the word's etymologies
  pronunciation  the word's pronunciations (IPA)

Prints each kind's compressed size, its raw size, and the whole file's as it is.

    python bench/layer_split.py path/to/headwords.definitions.bin

Needs the real file (a release's data-… assets), not the 5% sample: neighbouring
words share text, and that's what the blocks compress.
"""

import argparse
import concurrent.futures
import json
import os
import struct
import sys
import time

import brotli

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from definitions import HEADER, encode  # noqa: E402

KINDS = ("core", "examples", "etymology", "pronunciation")


def split_line(line):
    """One word's packed line as {kind: packed line}; b"" when it has none of a kind."""
    if not line:
        return {kind: b"" for kind in KINDS}
    packed = json.loads(line)
    forms, entries = packed[0], packed[1]
    etymologies = packed[2] if len(packed) > 2 else []
    sounds = packed[3] if len(packed) > 3 else []
    core_entries, examples = [], []
    for entry in entries:
        meanings = []
        for m in entry[2]:
            examples.append(m[5] if len(m) > 5 else "")
            m = list(m[:5])
            while m and m[-1] in ([], 0, "") and len(m) > 1:
                m.pop()
            meanings.append(m)
        core_entries.append([entry[0], entry[1], meanings, *entry[3:]])
    while examples and examples[-1] == "":
        examples.pop()
    return {
        "core": encode([forms, core_entries]),
        "examples": encode(examples) if examples else b"",
        "etymology": encode(etymologies) if etymologies else b"",
        "pronunciation": encode(sounds) if sounds else b"",
    }


def compress(raw):
    return len(brotli.compress(raw, quality=11, lgwin=22))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("definitions")
    parser.add_argument("--workers", type=int, default=os.cpu_count() or 1)
    args = parser.parse_args()

    with open(args.definitions, "rb") as f:
        data = f.read()
    _, version, _, num_words, per_block, num_blocks, tables_length, _ = HEADER.unpack_from(data)
    if version != 2:
        sys.exit(f"this measures a version-2 file (everything in one); that one is version {version}")
    offsets = struct.unpack_from(f"<{num_blocks + 1}I", data, HEADER.size + tables_length)
    overhead = offsets[0]  # header, tables, block offsets: each kind's file has its own copy

    raw = {kind: 0 for kind in KINDS}
    packed = {kind: 0 for kind in KINDS}
    words = {kind: 0 for kind in KINDS}
    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(args.workers) as pool:
        pending = []
        for b in range(num_blocks):
            lines = brotli.decompress(data[offsets[b]:offsets[b + 1]]).split(b"\n")
            parts = {kind: [] for kind in KINDS}
            for line in lines:
                for kind, value in split_line(line).items():
                    parts[kind].append(value)
                    words[kind] += bool(value)
            for kind in KINDS:
                block = b"\n".join(parts[kind])
                raw[kind] += len(block)
                pending.append((kind, pool.submit(compress, block)))
            while len(pending) > 8 * args.workers:
                kind, future = pending.pop(0)
                packed[kind] += future.result()
            if b % 32 == 0:
                print(f"  block {b}/{num_blocks}, {time.time() - started:.0f} s", file=sys.stderr)
        for kind, future in pending:
            packed[kind] += future.result()

    mb = lambda n: f"{n / 1e6:.1f} MB"
    print(f"\n{num_words:,} words, {num_blocks:,} blocks of {per_block:,}; "
          f"the file as it is: {mb(len(data))}\n")
    print(f"| Kind | Words with it | Raw | Packed (+ {mb(overhead)} index each) |")
    print("|---|---|---|---|")
    for kind in KINDS:
        print(f"| {kind} | {words[kind]:,} | {mb(raw[kind])} | {mb(packed[kind] + overhead)} |")
    total = sum(packed.values()) + overhead * len(KINDS)
    print(f"| all four | | {mb(sum(raw.values()))} | {mb(total)} |")


if __name__ == "__main__":
    main()
