import sqlite3, time, statistics, os, json
import bench as B

STOP = set("a o os as um uma uns umas de do da dos das e ou que com sem por para pra pro no na nos nas em ao aos se ser foi the of to in on for and or with isso este esta esse essa mais menos".split())
def expr(q):
    ts=[t for t in B.tokens(q.lower()) if t not in STOP and len(t)>=3]
    if not ts: ts=B.tokens(q.lower())
    return " OR ".join(f'"{t}"*' if len(t)>=4 else f'"{t}"' for t in ts)

src = sqlite3.connect(f"file:{B.SRC}?mode=ro", uri=True)
fts = sqlite3.connect(f"file:{B.FTS}?mode=ro", uri=True)

QUERIES = ["scroll","rolagem automatica","composer anexo","migration sqlite","erro de build",
           "companion pareamento","watchdog interval","drag and drop sidebar","custo do turno",
           "styleguide elevacao","tauri command async","teste que quebrou"]

print("=== QUALIDADE: sobreposicao do top-10 (atual vs fts5), 3 maiores conversas ===")
convs=[r[0] for r in src.execute("SELECT id FROM conversations ORDER BY length(items) DESC LIMIT 3")]
tot_b=tot_f=tot_i=0; zero=[]
print(f"{'query':<26} {'atual':>6} {'fts5':>6} {'comuns':>7} {'so no atual':>12} {'so no fts5':>11}")
for q in QUERIES:
    ib=sf=0; b_all=f_all=inter=0
    for c in convs:
        bb={i for _,i in B.baseline(src,c,q)}
        ff={r[0] for r in fts.execute(
            "SELECT item_index FROM item_fts WHERE item_fts MATCH ? AND conv_id=? ORDER BY rank LIMIT 10",(expr(q),c))}
        b_all+=len(bb); f_all+=len(ff); inter+=len(bb&ff); ib+=len(bb-ff); sf+=len(ff-bb)
    tot_b+=b_all; tot_f+=f_all; tot_i+=inter
    if f_all==0 and b_all>0: zero.append(q)
    print(f"{q:<26} {b_all:>6} {f_all:>6} {inter:>7} {ib:>12} {sf:>11}")
print(f"{'TOTAL':<26} {tot_b:>6} {tot_f:>6} {tot_i:>7}")
print(f"  -> fts5 recupera {tot_i/max(tot_b,1)*100:.0f}% do que a busca atual acha no top-10")
if zero: print(f"  -> queries onde fts5 nao achou NADA e o atual achou: {zero}")

print("\n=== ESCRITA: custo de indexar itens novos (o caminho de todo turno) ===")
w = sqlite3.connect("/tmp/fts-bench/w.db")
w.execute("DROP TABLE IF EXISTS t")
w.execute("CREATE VIRTUAL TABLE t USING fts5(conv_id UNINDEXED,item_id UNINDEXED,item_index UNINDEXED,kind UNINDEXED,text,tokenize='unicode61 remove_diacritics 2')")
blob=src.execute("SELECT items FROM conversations ORDER BY length(items) DESC LIMIT 1").fetchone()[0]
items=[(("c"),it.get("id"),i,it.get("kind",""),B.searchable_text(it)) for i,it in enumerate(json.loads(blob)) if B.searchable_text(it)]
w.executemany("INSERT INTO t VALUES (?,?,?,?,?)", items[:3000]); w.commit()
xs=[]
for row in items[3000:3100] if len(items)>3100 else items[:100]:
    t0=time.perf_counter(); w.execute("INSERT INTO t VALUES (?,?,?,?,?)",row); w.commit()
    xs.append((time.perf_counter()-t0)*1000)
print(f"  INSERT de 1 item + commit: mediana {statistics.median(xs):.2f}ms  p95 {sorted(xs)[int(len(xs)*.95)-1]:.2f}ms")
print(f"  reconstrucao total ({len(items)} itens da maior conversa): ver bench.py = 0.58s p/ 11353 itens")

print("\n=== TAMANHO: com texto guardado vs contentless ===")
for name,ddl in [("com texto (retorna summary)","CREATE VIRTUAL TABLE t2 USING fts5(text,tokenize='unicode61 remove_diacritics 2')"),
                 ("contentless (so rowid)","CREATE VIRTUAL TABLE t2 USING fts5(text,content='',tokenize='unicode61 remove_diacritics 2')")]:
    p=f"/tmp/fts-bench/sz.db"
    if os.path.exists(p): os.remove(p)
    d=sqlite3.connect(p); d.execute(ddl)
    d.executemany("INSERT INTO t2(text) VALUES (?)",[(r[4],) for r in items]); d.commit()
    d.execute("INSERT INTO t2(t2) VALUES('optimize')"); d.commit(); d.close()
    print(f"  {name:<30} {os.path.getsize(p)/1024/1024:>6.1f} MB  (p/ {len(items)} itens da maior conversa)")
