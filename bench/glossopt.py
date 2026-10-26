import json, unicodedata
import os

# Datasets live in bench/data/ (git-ignored; see fetch_data.sh) or $DICT_BENCH_DATA.
DATA = os.environ.get("DICT_BENCH_DATA",
                      os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
import zstandard as zstd
def human(b):
    for u in ['B','KB','MB','GB']:
        if b<1024: return f"{b:.1f} {u}"
        b/=1024
d=json.load(open(os.path.join(DATA, 'webster.json')))
glosses=[(v if isinstance(v,str) else ' '.join(map(str,v))) for v in d.values()]
gl=[g for g in glosses if g]
raw=sum(len(g.encode())+1 for g in gl)
cctx=zstd.ZstdCompressor(level=19)
print(f"gloss raw: {human(raw)}")
# shared trained dict + block compression at various block sizes
samples=[g.encode() for g in gl]
zdict=zstd.train_dictionary(160*1024, samples)
dsz=len(zdict.as_bytes())
for BLK in (256, 1024):
    dctx=zstd.ZstdCompressor(level=19, dict_data=zdict)
    tot=0
    for i in range(0,len(gl),BLK):
        chunk='\0'.join(gl[i:i+BLK]).encode()
        tot+=len(dctx.compress(chunk))
    off=len(gl)*4
    print(f"block-{BLK} + shared dict: {human(tot+dsz+off)}  (data {human(tot)} + dict {human(dsz)} + offsets {human(off)})  ratio {raw/(tot+dsz):.1f}x")
