#!/usr/bin/env python3
"""How big are the definitions, packed different ways? (ADR-0004's evidence.)

Reads a sample made by scripts/sample_definitions.py (every 20th English word
of the Wiktionary dump), puts it through the builder's own definition_of() and
pack(), groups it per search key in key order like the real file, and prints
whole-dictionary sizes (the sample scaled by its .stats.json totals) for each
codec and block size, plus what each extra (etymology, pronunciation, one
example per meaning) adds.

    python bench/definitions_packing.py definitions-sample.jsonl.gz

The sample's neighbouring words are 20 apart, so they share less text than in
the real file: real blocks compress somewhat better than these figures.
"""

import argparse
import gzip
import json
import os
import sys
import zlib

import brotli

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from build_fm_index import normalize  # noqa: E402
from definitions import definition_of, encode, pack, packing_tables  # noqa: E402

BLOCKS = (256, 1024, 4096)


def wiktextract_shape(entry):
    """The sampler stores linked words as strings; definition_of reads
    {"word": ...}. Samples taken before the sampler kept each example's type
    have bare strings, which read as usage examples."""
    senses = []
    for sense in entry.get("senses", []):
        sense = dict(sense)
        for key in ("form_of", "alt_of"):
            if key in sense:
                sense[key] = [{"word": w} for w in sense[key]]
        if "examples" in sense:
            sense["examples"] = [ex if isinstance(ex, dict) else {"text": ex} for ex in sense["examples"]]
        senses.append(sense)
    shaped = {**entry, "senses": senses}
    if "ipa" in entry:
        shaped["sounds"] = [{"ipa": i} for i in entry["ipa"]]
    return shaped


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("sample", help="definitions-sample.jsonl.gz from scripts/sample_definitions.py")
    parser.add_argument("--stats", help="its .stats.json (default: beside the sample)")
    args = parser.parse_args()
    stats_path = args.stats or args.sample.replace(".jsonl.gz", ".stats.json")
    with open(stats_path, encoding="utf-8") as f:
        stats = json.load(f)
    scale = stats["totals"]["entries"] / stats["sampled_entries"]

    # The sample's definitions, per search key, in key order (as the real file has them).
    per_key = {}
    with gzip.open(args.sample, "rt", encoding="utf-8") as f:
        for line in f:
            found = definition_of(wiktextract_shape(json.loads(line)))
            if found:
                per_key.setdefault(normalize(found["form"]), []).append(found)
    keys = sorted(per_key, key=lambda k: k.encode("utf-8"))
    print(f"{sum(len(v) for v in per_key.values()):,} entries under {len(keys):,} keys; "
          f"x{scale:.2f} for the whole dictionary\n")

    def without(*fields):
        def strip(d):
            kept = {k: v for k, v in d.items() if k not in fields}
            if "example" in fields:
                kept["meanings"] = [{k: v for k, v in m.items() if k != "example"} for m in d["meanings"]]
            return kept
        return [[strip(d) for d in per_key[k]] for k in keys]

    variants = {
        "definitions only": without("etymology", "ipa", "example"),
        "+ pronunciation": without("etymology", "example"),
        "+ etymology": without("example"),
        "+ examples": without(),
    }
    mb = lambda n: f"{n * scale / 1e6:6.1f} MB"
    print(f"{'contents':<18}{'packing':<9}{'block':>6}{'zlib-9':>10}{'brotli-11':>11}")
    for name, defs in variants.items():
        tables = packing_tables(defs)
        lines = {"JSON": [encode(d) for d in defs], "compact": [pack(k, d, tables) for k, d in zip(keys, defs)]}
        for packing, packed in lines.items():
            if packing == "JSON" and name != "definitions only":
                continue
            for size in BLOCKS:
                blocks = [b"\n".join(packed[i:i + size]) for i in range(0, len(packed), size)]
                z = sum(len(zlib.compress(b, 9)) for b in blocks)
                br = sum(len(brotli.compress(b, quality=11, lgwin=22)) for b in blocks)
                print(f"{name:<18}{packing:<9}{size:>6}{mb(z):>10}{mb(br):>11}")


if __name__ == "__main__":
    main()
