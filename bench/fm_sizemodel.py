import numpy as np, bz2, math
import os

# Datasets live in bench/data/ (git-ignored; see fetch_data.sh) or $DICT_BENCH_DATA.
DATA = os.environ.get("DICT_BENCH_DATA",
                      os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
from pydivsufsort import divsufsort
import zstandard as zstd
SEP=0x0a; TERM=0x00
words=[w.strip() for w in open(os.path.join(DATA, 'words_alpha.txt'),'rb') if w.strip()]
T=bytes([SEP]).join(words)+bytes([SEP])+bytes([TERM]); n=len(T)
SA=divsufsort(T); Tarr=np.frombuffer(T,np.uint8)
bwt=Tarr[(SA.astype(np.int64)-1)%n].tobytes()
sigma=len(set(bwt))
def human(b):
    for u in ['B','KB','MB','GB']:
        if b<1024: return f"{b:.1f}{u}"
        b/=1024
cctx=zstd.ZstdCompressor(level=19)
comp_bwt=min(len(cctx.compress(bwt)), len(bz2.compress(bwt,9)))
comp_raw=len(cctx.compress(T))
print(f"raw text            : {human(n)}")
print(f"zstd-19 raw (data)  : {human(comp_raw)}  <- 'just compress, no search'")
print(f"compressed BWT      : {human(comp_bwt)}")
print(f"alphabet sigma      : {sigma}  -> {math.ceil(math.log2(sigma))} bits/symbol")
print()
# locate options
sampled_sa_32 = (n//32)*4 + n//8
# separator-rank locate: bitvector marking SEPs (n bits) + select support (~ small)
sep_locate = n//8 + (n//8)//4
print("--- LOCATE structure options ---")
print(f"  sampled SA (s=32)     : {human(sampled_sa_32)}")
print(f"  separator-rank trick  : {human(sep_locate)}  <- cheaper, we split on '\\n'")
print()
print("--- RANK structure: naive checkpoints vs engineered ---")
for cp in (64,128,256,512):
    for bytesper,label in ((4,'int32'),(2,'int16')):
        rank=(n//cp+1)*sigma*bytesper
        print(f"  checkpoint={cp:4d} {label}: rank={human(rank):>8}", end='')
    print()
# wavelet tree estimate: ceil(log2 sigma) bits/symbol + ~25% rank overhead; RRR ~ entropy
wt_plain = math.ceil(math.log2(sigma))*n/8
wt_rank_overhead = wt_plain*0.25
wt = wt_plain + wt_rank_overhead
print(f"  wavelet tree (plain 5-bit + 25% rank): {human(wt)}")
print(f"  wavelet tree (RRR ~ entropy)         : ~{human(comp_bwt*1.4)}")
print()
print("=== TOTAL FM-index estimates (count + locate) ===")
naive = comp_bwt + (n//64+1)*sigma*4 + sampled_sa_32
eng   = comp_bwt*1.4 + sep_locate   # wavelet-RRR rank fused with compressed bwt + sep locate
print(f"  NAIVE (cp64 int32 + sampled SA)   : {human(naive)}  = {naive/n*100:.0f}% of raw")
print(f"  ENGINEERED (RRR-WT + sep locate)  : {human(eng)}  = {eng/n*100:.0f}% of raw")
print(f"  reference: zstd data only         : {human(comp_raw)}  (no substring search)")
