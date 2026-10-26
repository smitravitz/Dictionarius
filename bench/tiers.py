#!/usr/bin/env python3
"""Zipf gloss-tiering preview: rank Webster headwords by real word frequency,
model core size vs lookup coverage for each tier. Headwords ALWAYS fully
searchable (FM-index); only GLOSSES are tiered (core vs on-demand tail)."""
import json, unicodedata
import os

# Datasets live in bench/data/ (git-ignored; see fetch_data.sh) or $DICT_BENCH_DATA.
DATA = os.environ.get("DICT_BENCH_DATA",
                      os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
import zstandard as zstd
from wordfreq import word_frequency

def human(b):
    for u in ['B','KB','MB','GB']:
        if b<1024: return f"{b:.1f} {u}"
        b/=1024
    return f"{b:.1f} TB"

d = json.load(open(os.path.join(DATA, 'webster.json')))
items = [(k, (v if isinstance(v,str) else ' '.join(map(str,v)))) for k,v in d.items() if k.strip()]
# frequency of the headword (lowercased, first token for multiword)
def freq(w):
    w = w.lower().strip()
    return word_frequency(w, 'en')
ranked = sorted(items, key=lambda kv: freq(kv[0]), reverse=True)
total_freq = sum(freq(k) for k,_ in items) or 1.0
n = len(ranked)
print(f"entries: {n:,}   (ranked by real English word frequency)")

cctx = zstd.ZstdCompressor(level=19)
def gloss_size(subset):
    """block-256 + shared trained dict; realistic random-access gloss store."""
    gls = [g.encode() for _,g in subset if g]
    if not gls: return 0
    try:
        zd = zstd.train_dictionary(112*1024, gls)
        dctx = zstd.ZstdCompressor(level=19, dict_data=zd)
        dsz = len(zd.as_bytes())
    except Exception:
        dctx = cctx; dsz = 0
    tot = 0
    for i in range(0, len(gls), 256):
        tot += len(dctx.compress(b'\0'.join(gls[i:i+256])))
    return tot + dsz + len(gls)*4  # + offsets

FM_FULL_WEBSTER = 713*1024          # engineered FM over ALL Webster headwords (prior measure)
# tiers larger than the dataset collapse into "ALL", so drop them
tiers = [t for t in (2000, 5000, 20000, 50000, 150000) if t < n] + [n]
print(f"\n{'tier (top-N)':>14} | {'core glosses':>12} | {'+FM all-words':>13} | {'text coverage':>13}")
print("-"*62)
rows=[]
for N in tiers:
    sub = ranked[:N]
    cov = sum(freq(k) for k,_ in sub)/total_freq*100
    gl = gloss_size(sub)
    core = gl + FM_FULL_WEBSTER
    label = "ALL" if N>=n else f"{N:,}"
    rows.append((label, gl, core, cov))
    print(f"{label:>14} | {human(gl):>12} | {human(core):>13} | {cov:>11.1f} %")

print("\nNOTE: headwords for ALL words are in the FM-index in every tier — nothing")
print("becomes unsearchable; sub-core words just fetch their definition on demand.")
print("Core sizes are ~scale-invariant: the top-N common words are the same whether")
print("the full dictionary has 102k or 1.39M entries — only the on-demand TAIL grows.")

