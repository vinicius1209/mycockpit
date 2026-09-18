import sqlite3, time, statistics, os
import bench as B

fts = sqlite3.connect(f"file:{B.FTS}?mode=ro", uri=True)
src = sqlite3.connect(f"file:{B.SRC}?mode=ro", uri=True)
CONV = src.execute("SELECT id FROM conversations ORDER BY length(items) DESC LIMIT 1").fetchone()[0]

def run(expr, conv=CONV, limit=10):
    return fts.execute("SELECT item_index FROM item_fts WHERE item_fts MATCH ? AND conv_id=? "
                       "ORDER BY rank LIMIT ?", (expr, conv, limit)).fetchall()

print("=== por que 'erro de build' custa 16ms: quantos docs cada termo casa ===")
for t in ["erro", "de", "build", "de*", "erro*", "build*"]:
    t0=time.perf_counter()
    n = fts.execute("SELECT count(*) FROM item_fts WHERE item_fts MATCH ?", (f'"{t}"' if "*" not in t else f'"{t[:-1]}"*',)).fetchone()[0]
    print(f"  {t:<8} casa {n:>6} docs   ({(time.perf_counter()-t0)*1000:.1f}ms)")

print("\n=== variantes de montagem da query (mediana de 15 runs) ===")
STOP = B.__dict__.get("STOP") or set("de do da em no na os as um uma que com sem por para pra e ou".split())

def expr_prefix_all(q):   # o que testei antes
    return " OR ".join(f'"{t}"*' for t in B.tokens(q.lower()))
def expr_no_prefix(q):
    return " OR ".join(f'"{t}"' for t in B.tokens(q.lower()))
def expr_prefix_ge4(q):   # prefixo so em token >=4 chars
    return " OR ".join(f'"{t}"*' if len(t) >= 4 else f'"{t}"' for t in B.tokens(q.lower()))
def expr_stop_ge4(q):     # stopwords fora + prefixo so em >=4
    ts = [t for t in B.tokens(q.lower()) if t not in STOP and len(t) >= 3]
    if not ts: ts = B.tokens(q.lower())
    return " OR ".join(f'"{t}"*' if len(t) >= 4 else f'"{t}"' for t in ts)

QUERIES = ["scroll", "rolagem automatica", "erro de build", "composer anexo",
           "migration sqlite", "companion pareamento", "o que quebrou no fio de chat"]
variants = [("prefix em tudo", expr_prefix_all), ("sem prefixo", expr_no_prefix),
            ("prefix >=4", expr_prefix_ge4), ("stopword + prefix >=4", expr_stop_ge4)]

print(f"{'query':<30} " + " ".join(f"{n:>22}" for n,_ in variants))
for q in QUERIES:
    cells=[]
    for _, fn in variants:
        e = fn(q)
        xs=[]
        for _ in range(15):
            t0=time.perf_counter(); r=run(e); xs.append((time.perf_counter()-t0)*1000)
        cells.append(f"{statistics.median(xs):>8.2f}ms ({len(r):>2} hits)")
    print(f"{q:<30} " + " ".join(f"{c:>22}" for c in cells))
