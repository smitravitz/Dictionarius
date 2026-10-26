#!/usr/bin/env python3
"""Full local-dictionary size model on REAL data (Webster's 1913, 102,217 entries).
Measures every shipped layer: FM-index over headwords, compressed gloss blob +
offsets, and totals — so we know the TRUE app size and FM-index's share of it."""
import json, bz2, unicodedata, math
import os

# Datasets live in bench/data/ (git-ignored; see fetch_data.sh) or $DICT_BENCH_DATA.
DATA = os.environ.get("DICT_BENCH_DATA",
                      os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
import numpy as np
from pydivsufsort import divsufsort
import zstandard as zstd

def human(b):
    for u in ['B','KB','MB','GB']:
        if b < 1024: return f"{b:.1f} {u}"
        b/=1024
    return f"{b:.1f} TB"

def norm(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return s.lower().strip()

d = json.load(open(os.path.join(DATA, 'webster.json')))
# some values may be strings (compact) or lists; coerce to one gloss string
headwords, glosses = [], []
for k, v in d.items():
    if not k.strip(): continue
    g = v if isinstance(v, str) else ' '.join(map(str, v))
    headwords.append(k)
    glosses.append(g)
n = len(headwords)
print(f"entries: {n:,}")

raw_json = len(open(os.path.join(DATA, 'webster.json'),'rb').read())
hw_text = '\n'.join(norm(h) for h in headwords)
gl_text = '\0'.join(glosses)
hw_bytes = hw_text.encode('utf-8')
gl_bytes = gl_text.encode('utf-8')
print(f"raw JSON file           : {human(raw_json)}")
print(f"headword text (norm)    : {human(len(hw_bytes))}")
print(f"gloss/definition text   : {human(len(gl_bytes))}")
print(f"  gloss : headword ratio: {len(gl_bytes)/len(hw_bytes):.1f}x  <- glosses dominate")
print()

# ---------- LAYER 1: FM-index over headwords ----------
SEP, TERM = 1, 0
codes = bytearray()
for h in headwords:
    codes.append(SEP)
    codes += norm(h).encode('utf-8')
codes.append(SEP);
T = bytes(codes) + bytes([TERM])
Tn = len(T)
SA = divsufsort(T)
Tarr = np.frombuffer(T, np.uint8)
bwt = Tarr[(SA.astype(np.int64)-1) % Tn].tobytes()
sigma = len(set(bwt))
cctx = zstd.ZstdCompressor(level=19)
comp_bwt = min(len(cctx.compress(bwt)), len(bz2.compress(bwt,9)))
# naive rank (cp=64,int32) + sampled SA(s=32); engineered (RRR-WT ~1.4x comp_bwt + separator locate)
rank_naive = (Tn//64+1)*sigma*4
locate_naive = (Tn//32)*4 + Tn//8
sep_locate = Tn//8 + (Tn//8)//4
fm_naive = comp_bwt + rank_naive + locate_naive
fm_eng   = int(comp_bwt*1.4) + sep_locate
print("LAYER 1 — FM-index over headwords (mid-word search):")
print(f"  compressed BWT        : {human(comp_bwt)}")
print(f"  FM naive (measured-model): {human(fm_naive)}")
print(f"  FM engineered (model) : {human(fm_eng)}")
print()

# ---------- LAYER 2: gloss storage ----------
# (a) whole-blob zstd (best ratio, needs block/seek for random access)
gl_blob = len(cctx.compress(gl_bytes))
# (b) per-entry with TRAINED dictionary (true random access per definition)
samples = [g.encode('utf-8') for g in glosses if g]
try:
    zdict = zstd.train_dictionary(112*1024, samples)
    dctx = zstd.ZstdCompressor(level=19, dict_data=zdict)
    per_entry = sum(len(dctx.compress(s)) for s in samples)
    dict_sz = len(zdict.as_bytes())
except Exception as e:
    per_entry = 0; dict_sz = 0; print("dict train failed:", e)
# (c) block compression: groups of 64 entries -> one zstd frame (random access to a block)
BLK=64
block_total=0
for i in range(0, n, BLK):
    chunk = '\0'.join(glosses[i:i+BLK]).encode('utf-8')
    block_total += len(cctx.compress(chunk))
offsets = n*4  # 4 bytes per entry offset
print("LAYER 2 — gloss storage (+ offsets", human(offsets), "):")
print(f"  whole-blob zstd (seek): {human(gl_blob)}   ratio {len(gl_bytes)/gl_blob:.1f}x")
print(f"  block-64 zstd (random): {human(block_total)}   ratio {len(gl_bytes)/block_total:.1f}x")
if per_entry:
    print(f"  per-entry+dict (random): {human(per_entry+dict_sz)}   ratio {len(gl_bytes)/(per_entry+dict_sz):.1f}x")
print()

# ---------- TOTALS ----------
gloss_ship = block_total + offsets           # realistic: random-access blocks
core_eng = fm_eng + gloss_ship
core_naive = fm_naive + gloss_ship
print("=== TOTAL CORE APP DATA (headword search + all definitions) ===")
print(f"  raw JSON (baseline)               : {human(raw_json)}")
print(f"  gloss(block) + offsets            : {human(gloss_ship)}")
print(f"  + FM engineered headword index    : {human(core_eng)}   ({core_eng/raw_json*100:.0f}% of raw JSON)")
print(f"  + FM naive headword index         : {human(core_naive)}")
print(f"  FM index as share of total (eng)  : {fm_eng/core_eng*100:.1f}%")
print()
# ---------- EXTRAPOLATE to full Kaikki English scale ----------
FULL=1_390_507
sc=FULL/n
print(f"=== EXTRAPOLATION to {FULL:,} entries (x{sc:.1f}) — proxy, Webster def-length ===")
print(f"  gloss(block)+offsets  : {human(gloss_ship*sc)}")
print(f"  FM engineered index   : {human(fm_eng*sc)}")
print(f"  TOTAL core (eng)      : {human(core_eng*sc)}")
