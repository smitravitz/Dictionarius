#!/usr/bin/env python3
"""Upgrade a version-2 definitions file (everything in one file) to version 3: the
core plus a layer file each for examples, etymology and pronunciation (ADR-0005),
without the Wiktionary dump or the word list. Each word's version-2 line splits
into exactly the lines pack() writes, and the builder's own writer writes them,
so the files are the ones a fresh build from the same dump would write.

    python scripts/upgrade_definitions.py dist/headwords.definitions.bin

Replaces the file in place and writes the layers beside it (dist/headwords.examples.bin, …).
"""

import argparse
import json
import os
import struct
import sys
import tempfile

import brotli

sys.path.insert(0, os.path.dirname(__file__))
from definitions import HEADER, LAYERS, MAGIC, encode, layer_path, trim, write_packed  # noqa: E402


def split_v2(line):
    """A version-2 line ([forms, entries, etymologies, pronunciations], each meaning
    ending with its example) as pack()'s {kind: line}."""
    packed = json.loads(line)
    forms, entries = packed[0], packed[1]
    etymologies = packed[2] if len(packed) > 2 else []
    sounds = packed[3] if len(packed) > 3 else []
    core_entries, examples = [], []
    for entry in entries:
        meanings = []
        for m in entry[2]:
            examples.append(m[5] if len(m) > 5 else "")
            meanings.append(trim(list(m[:5]), [None, [], [], 0, []]))
        core_entries.append([entry[0], entry[1], meanings, *entry[3:]])
    while examples and examples[-1] == "":
        examples.pop()
    return {"core": encode([forms, core_entries]),
            "examples": encode(examples) if examples else b"",
            "etymology": encode(etymologies) if etymologies else b"",
            "pronunciation": encode(sounds) if sounds else b""}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("definitions", help="the version-2 ….definitions.bin")
    path = parser.parse_args().definitions

    with open(path, "rb") as f:
        data = f.read()
    magic, version, _, num_words, per_block, num_blocks, tables_length, keys_hash = HEADER.unpack_from(data)
    if magic != MAGIC or version != 2:
        sys.exit(f"{path} isn't a version-2 definitions file (version {version})")
    tables = json.loads(data[HEADER.size:HEADER.size + tables_length])
    offsets = struct.unpack_from(f"<{num_blocks + 1}I", data, HEADER.size + tables_length)

    def by_id():
        for b in range(num_blocks):
            for j, line in enumerate(brotli.decompress(data[offsets[b]:offsets[b + 1]]).split(b"\n")):
                if line:
                    yield b * per_block + j, split_v2(line)

    # Written into a folder beside the old file first, then moved over it: a failure leaves it as it was.
    folder = os.path.dirname(os.path.abspath(path))
    with tempfile.TemporaryDirectory(dir=folder) as tmp:
        new = os.path.join(tmp, os.path.basename(path))
        write_packed(new, num_words, by_id(), keys_hash, tables, per_block=per_block)
        for target in [path] + [layer_path(path, kind) for kind in LAYERS]:
            os.replace(os.path.join(tmp, os.path.basename(target)), target)
            print(f"wrote {target} ({os.path.getsize(target) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
