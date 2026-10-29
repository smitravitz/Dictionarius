#!/usr/bin/env python3
"""Take a small, fixed sample of the dictionary's definitions, to measure how
best to pack them (compression, what to keep).

Reads the same Wiktionary dump the index builder reads, keeps the English
entries of every 20th word (picked by a hash of the word, so the same words
every run, with all of a word's entries together), and writes only the parts a
definition could use. It also counts every English entry, so totals for the
whole dictionary don't need the whole file.

    python scripts/sample_definitions.py raw-wiktextract-data.jsonl
    -> definitions-sample.jsonl.gz (a few MB) and definitions-sample.stats.json

Options: --every N (keep 1 word in N; default 20), --out PATH, --lang CODE.
"""

import argparse
import gzip
import json
import time
import zlib

try:
    import orjson  # optional, faster parsing of the multi-GB dump

    loads = orjson.loads
except ImportError:
    loads = json.loads


def keep_sense(sense):
    """The parts of one meaning a definition could show."""
    kept = {}
    for key in ("glosses", "raw_glosses", "tags", "qualifier"):
        if sense.get(key):
            kept[key] = sense[key]
    for key in ("form_of", "alt_of"):
        words = [link.get("word") for link in sense.get(key) or () if isinstance(link, dict)]
        if words:
            kept[key] = words
    # Each example's text, its type ("example" or "quotation") and whether it has a source.
    examples = [{"text": ex["text"], "type": ex.get("type"), "ref": bool(ex.get("ref"))}
                for ex in sense.get("examples") or () if isinstance(ex, dict) and ex.get("text")]
    if examples:
        kept["examples"] = examples
    return kept


def keep_entry(obj):
    """The parts of one entry a definition could show."""
    kept = {"word": obj["word"], "pos": obj.get("pos")}
    if obj.get("etymology_number"):
        kept["etymology_number"] = obj["etymology_number"]
    if obj.get("etymology_text"):
        kept["etymology_text"] = obj["etymology_text"]
    ipa = [s["ipa"] for s in obj.get("sounds") or () if isinstance(s, dict) and s.get("ipa")]
    if ipa:
        kept["ipa"] = ipa
    kept["senses"] = [keep_sense(s) for s in obj.get("senses") or () if isinstance(s, dict)]
    return kept


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("input", help="the Wiktionary dump (.jsonl or .jsonl.gz)")
    parser.add_argument("--every", type=int, default=20, help="keep 1 word in N (default 20)")
    parser.add_argument("--out", default="definitions-sample.jsonl.gz")
    parser.add_argument("--lang", default="en")
    args = parser.parse_args()

    # Totals over every English entry, sampled or not.
    totals = {"entries": 0, "words": 0, "senses": 0, "form_of_senses": 0, "gloss_chars": 0,
              "example_chars": 0, "etymology_chars": 0, "ipa": 0}
    seen_words = set()
    kept_entries = 0
    started = time.time()
    opener = gzip.open if args.input.lower().endswith(".gz") else open

    with opener(args.input, "rb") as dump, gzip.open(args.out, "wb") as out:
        for n, line in enumerate(dump, 1):
            if n % 500_000 == 0:
                print(f"  {n:,} lines read, {totals['entries']:,} English entries ({time.time() - started:.0f}s)")
            try:
                obj = loads(line)
            except ValueError:
                continue
            if not isinstance(obj, dict) or obj.get("lang_code") != args.lang:
                continue
            word = obj.get("word")
            if not isinstance(word, str):
                continue

            # Count everything, for the whole-dictionary totals.
            entry = keep_entry(obj)
            totals["entries"] += 1
            if word not in seen_words:
                seen_words.add(word)
                totals["words"] += 1
            for sense in entry["senses"]:
                totals["senses"] += 1
                if "form_of" in sense or "alt_of" in sense:
                    totals["form_of_senses"] += 1
                totals["gloss_chars"] += sum(len(g) for g in sense.get("glosses", ()))
                totals["example_chars"] += sum(len(e) for e in sense.get("examples", ()))
            totals["etymology_chars"] += len(entry.get("etymology_text", ""))
            totals["ipa"] += len(entry.get("ipa", ()))

            # Keep every Nth word, all of its entries.
            if zlib.crc32(word.encode("utf-8")) % args.every == 0:
                out.write(json.dumps(entry, ensure_ascii=False).encode("utf-8") + b"\n")
                kept_entries += 1

    stats = {"every": args.every, "sampled_entries": kept_entries, "totals": totals}
    stats_path = args.out.replace(".jsonl.gz", "") + ".stats.json"
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=1)
    print(f"kept {kept_entries:,} of {totals['entries']:,} English entries -> {args.out}")
    print(f"totals -> {stats_path}")


if __name__ == "__main__":
    main()
