import sqlite3, os, time, random
import tempfile

# Datasets live in bench/data/ (git-ignored; see fetch_data.sh) or $DICT_BENCH_DATA.
DATA = os.environ.get("DICT_BENCH_DATA",
                      os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
OUT = tempfile.mkdtemp(prefix="dictionarily-bench-")
words=[w.strip().decode() for w in open(os.path.join(DATA, 'words_alpha.txt'),'rb') if w.strip()]
def human(b):
    for u in ['B','KB','MB','GB']:
        if b<1024: return f"{b:.1f}{u}"
        b/=1024

# --- Baseline A: plain table + B-tree, LIKE '%q%' (full scan) ---
for path in (os.path.join(OUT, 'plain.db'),os.path.join(OUT, 'tri.db')): 
    if os.path.exists(path): os.remove(path)
c=sqlite3.connect(os.path.join(OUT, 'plain.db'))
c.execute('CREATE TABLE w(word TEXT)'); c.executemany('INSERT INTO w VALUES(?)',[(x,) for x in words])
c.execute('CREATE INDEX i ON w(word)')  # helps prefix, NOT substring
c.commit(); c.execute('VACUUM'); c.commit(); c.close()
plain_sz=os.path.getsize(os.path.join(OUT, 'plain.db'))

# --- Baseline B: FTS5 trigram (enables substring) ---
c=sqlite3.connect(os.path.join(OUT, 'tri.db'))
c.execute("CREATE VIRTUAL TABLE w USING fts5(word, tokenize=trigram)")
c.executemany('INSERT INTO w(word) VALUES(?)',[(x,) for x in words])
c.commit(); c.close()
tri_sz=os.path.getsize(os.path.join(OUT, 'tri.db'))

raw=sum(len(w)+1 for w in words)
print(f"words: {len(words):,}   raw text ~{human(raw)}")
print(f"plain.db (table+btree, no substring index): {human(plain_sz)}")
print(f"tri.db  (FTS5 trigram, substring-capable) : {human(tri_sz)}")
print(f"  -> trigram substring capability costs: {human(tri_sz-plain_sz)} extra vs plain table")
print()

# latency: substring queries
random.seed(2)
qs=[]
for _ in range(500):
    w=random.choice(words)
    if len(w)>=3:
        s=random.randint(0,len(w)-3); qs.append(w[s:s+3])

# trigram MATCH
c=sqlite3.connect(os.path.join(OUT, 'tri.db'))
t0=time.time()
for q in qs: c.execute("SELECT count(*) FROM w WHERE word MATCH ?", ('"%s"'%q,)).fetchone()
tri_match=(time.time()-t0)/len(qs)*1000
c.close()

# plain LIKE %q% full scan
c=sqlite3.connect(os.path.join(OUT, 'plain.db'))
t0=time.time()
for q in qs[:100]: c.execute("SELECT count(*) FROM w WHERE word LIKE ?", ('%%%s%%'%q,)).fetchone()
plain_like=(time.time()-t0)/100*1000
c.close()
print(f"FTS5 trigram MATCH latency : {tri_match:.4f} ms/query")
print(f"plain LIKE '%q%' scan      : {plain_like:.4f} ms/query  (the naive substring approach)")
