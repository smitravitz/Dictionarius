#!/usr/bin/env python3
"""FM-index viability benchmark on a real English wordlist.
Measures: index size vs raw/zstd, backward-search latency, correctness,
and (separately) an FTS5-trigram baseline for the same data."""
import time, bz2, sys
import os

# Datasets live in bench/data/ (git-ignored; see fetch_data.sh) or $DICT_BENCH_DATA.
DATA = os.environ.get("DICT_BENCH_DATA",
                      os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
import numpy as np
from pydivsufsort import divsufsort
import zstandard as zstd

SEP = 0x0a      # '\n' between words
TERM = 0x00     # unique smallest terminator

def load_words(path, limit=None):
    with open(path, 'rb') as f:
        words = [w.strip() for w in f if w.strip()]
    if limit: words = words[:limit]
    return words

def build_text(words):
    # T = w1 \n w2 \n ... wn \n \0
    body = bytes([SEP]).join(words)
    T = body + bytes([SEP]) + bytes([TERM])
    return T

def build_bwt(T):
    SA = divsufsort(T)                     # C-backed suffix array
    n = len(T)
    Tarr = np.frombuffer(T, dtype=np.uint8)
    prev = (SA.astype(np.int64) - 1) % n
    bwt = Tarr[prev].tobytes()
    return SA, bwt

class FMIndex:
    """Checkpointed-rank FM-index. Reports a realistic PACKED size model."""
    def __init__(self, bwt, checkpoint=64):
        self.bwt = bwt
        self.n = len(bwt)
        self.cp = checkpoint
        self.alpha = sorted(set(bwt))
        self.sigma = len(self.alpha)
        self.a2i = {c: i for i, c in enumerate(self.alpha)}
        counts = np.zeros(self.sigma, dtype=np.int64)
        for c in bwt: counts[self.a2i[c]] += 1
        # C[] cumulative (first-column starts)
        self.C = {}
        run = 0
        for i, c in enumerate(self.alpha):
            self.C[c] = run; run += int(counts[i])
        # rank checkpoints: cumulative occ of each symbol at every `cp` positions
        ncp = self.n // self.cp + 1
        self.ckpt = np.zeros((ncp, self.sigma), dtype=np.int32)
        acc = np.zeros(self.sigma, dtype=np.int32)
        bwt_arr = np.frombuffer(bwt, dtype=np.uint8)
        idx = {c: i for i, c in enumerate(self.alpha)}
        for pos in range(self.n):
            if pos % self.cp == 0:
                self.ckpt[pos // self.cp] = acc
            acc[idx[bwt_arr[pos]]] += 1
        self._bwt_arr = bwt_arr
        self._idx = idx

    def occ(self, c, i):
        """# of symbol c in bwt[0:i]"""
        if i <= 0: return 0
        ci = self._idx[c]
        block = i // self.cp
        base = int(self.ckpt[block, ci])
        start = block * self.cp
        seg = self._bwt_arr[start:i]
        base += int(np.count_nonzero(seg == c))
        return base

    def count(self, pattern):
        l, r = 0, self.n
        for c in reversed(pattern):
            if c not in self.C: return 0, (0, 0)
            l = self.C[c] + self.occ(c, l)
            r = self.C[c] + self.occ(c, r)
            if l >= r: return 0, (0, 0)
        return r - l, (l, r)

    def size_model(self, bwt_compressed_bytes, sa_sample=32):
        """Realistic packed on-disk size of the FM-index components."""
        n, sigma = self.n, self.sigma
        # rank checkpoints packed: (n/cp) * sigma * 4 bytes
        rank_bytes = (n // self.cp + 1) * sigma * 4
        # sampled suffix array for locate: (n/sa_sample)*4 + bitvector n/8
        sa_bytes = (n // sa_sample) * 4 + n // 8
        misc = sigma * 8  # C[] + alphabet
        return {
            'compressed_bwt': bwt_compressed_bytes,
            'rank_checkpoints': rank_bytes,
            'sampled_SA(locate)': sa_bytes,
            'misc': misc,
            'total': bwt_compressed_bytes + rank_bytes + sa_bytes + misc,
        }

def human(b):
    for u in ['B','KB','MB','GB']:
        if b < 1024: return f"{b:.1f}{u}"
        b /= 1024
    return f"{b:.1f}TB"

def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    words = load_words(os.path.join(DATA, 'words_alpha.txt'), limit)
    print(f"words: {len(words):,}")
    T = build_text(words)
    n = len(T)
    print(f"raw text: {human(len(T))} ({len(T):,} bytes)")

    t0 = time.time(); SA, bwt = build_bwt(T); t_build = time.time() - t0
    print(f"BWT+SA build: {t_build:.2f}s")

    # --- compression baselines ---
    cctx = zstd.ZstdCompressor(level=19)
    zraw = cctx.compress(T)
    zbwt = cctx.compress(bwt)
    bwt_bz2 = bz2.compress(bwt, 9)
    print(f"zstd-19 raw text : {human(len(zraw))}")
    print(f"zstd-19 BWT      : {human(len(zbwt))}")
    print(f"bz2 BWT          : {human(len(bwt_bz2))}")
    best_bwt = min(len(zbwt), len(bwt_bz2))

    # --- FM-index ---
    t0 = time.time(); fm = FMIndex(bwt, checkpoint=64); t_fm = time.time() - t0
    print(f"FM rank build: {t_fm:.2f}s  (alphabet sigma={fm.sigma})")
    sm = fm.size_model(best_bwt)
    print("--- FM-index size model ---")
    for k, v in sm.items(): print(f"  {k:22s}: {human(v)}")
    print(f"  FM-index vs raw text  : {sm['total']/len(T)*100:.1f}% of raw")

    # --- correctness: FM count vs brute force (overlapping) ---
    import random; random.seed(1)
    def brute_count(pat):
        c, start = 0, 0
        while True:
            i = T.find(pat, start)
            if i == -1: break
            c += 1; start = i + 1
        return c
    sample_words = random.sample(words, 40)
    ok = 0
    for w in sample_words:
        if len(w) < 3: continue
        s = random.randint(0, len(w)-3); pat = w[s:s+3]
        fmc = fm.count(pat)[0]; bc = brute_count(pat)
        ok += (fmc == bc)
    checked = sum(1 for w in sample_words if len(w) >= 3)
    print(f"correctness (3-gram counts match brute): {ok}/{checked}")
    if ok != checked:
        sys.exit(f"FAIL: FM-index count disagreed with brute force on {checked - ok} patterns")

    # --- locate correctness: map a match back to a word ---
    sep_positions = np.where(np.frombuffer(T, np.uint8) == SEP)[0]
    def word_at(textpos):
        j = np.searchsorted(sep_positions, textpos)
        lo = sep_positions[j-1]+1 if j>0 else 0
        hi = sep_positions[j] if j < len(sep_positions) else len(T)-1
        return T[lo:hi].decode('latin1')
    pat = b'eren'
    cnt, (l, r) = fm.count(pat)
    hits = sorted({word_at(int(SA[i])) for i in range(l, min(r, l+2000))})
    contains = sum(1 for h in hits if 'eren' in h)
    print(f"locate 'eren': {cnt} positions, {len(hits)} distinct words, {contains} truly contain 'eren'; e.g. {hits[:6]}")
    if cnt == 0 or contains != len(hits):
        sys.exit("FAIL: locate returned words that do not contain the pattern")

    # --- search latency ---
    queries = []
    for _ in range(2000):
        w = random.choice(words)
        if len(w) < 2: continue
        L = random.randint(2, min(6, len(w))); s = random.randint(0, len(w)-L)
        queries.append(w[s:s+L])
    t0 = time.time()
    for q in queries: fm.count(q)
    dt = (time.time()-t0)/len(queries)*1000
    print(f"FM backward-search latency: {dt:.4f} ms/query over {len(queries)} queries (pure Python)")

if __name__ == '__main__':
    main()
