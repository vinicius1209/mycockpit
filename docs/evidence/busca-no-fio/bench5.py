import sqlite3, time, statistics
import bench as B

STOP = set("a o os as um uma uns umas de do da dos das e ou que com sem por para pra pro no na nos nas em ao aos se ser foi the of to in on for and or with isso este esta esse essa mais menos".split())
def expr(q):
    ts=[t for t in B.tokens(q.lower()) if t not in STOP and len(t)>=3]
    if not ts: ts=B.tokens(q.lower())
    return " OR ".join(f'"{t}"*' if len(t)>=4 else f'"{t}"' for t in ts)

src=sqlite3.connect(f"file:{B.SRC}?mode=ro",uri=True)
fts=sqlite3.connect(f"file:{B.FTS}?mode=ro",uri=True)

# total de itens SEM tocar no blob: vem do proprio indice (max item_index).
TOTALS={cid:(n or 1) for cid,n in fts.execute(
    "SELECT conv_id, max(item_index)+1 FROM item_fts GROUP BY conv_id")}

def hybrid(conv,q,limit=10,cand=200):
    ql=q.strip().lower(); terms=B.tokens(ql); total=max(TOTALS.get(conv,1),1)
    rows=fts.execute("SELECT item_index,text FROM item_fts WHERE item_fts MATCH ? AND conv_id=? "
                     "ORDER BY rank LIMIT ?",(expr(q),conv,cand)).fetchall()
    hits=[]
    for index,text in rows:
        lower=text.lower()
        matched=sum(1 for t in terms if t in lower)
        if matched==0 and ql not in lower: continue
        score=(8.0 if ql in lower else 0.0)+(matched/max(len(terms),1))*6.0+index/total
        hits.append((score,index))
    hits.sort(key=lambda x:-x[0]); return hits[:limit]

QUERIES=["scroll","rolagem automatica","composer anexo","migration sqlite","erro de build",
         "companion pareamento","watchdog interval","drag and drop sidebar","custo do turno",
         "styleguide elevacao","tauri command async","teste que quebrou"]
convs=[r[0] for r in src.execute("SELECT id FROM conversations ORDER BY length(items) DESC LIMIT 3")]

print("=== varredura do limite de candidatos: fidelidade x latencia ===")
print(f"{'cand':>6} {'fidelidade':>11} {'lat. mediana':>13} {'lat. p95':>10}")
BASE={ (q,c): [i for _,i in B.baseline(src,c,q)] for q in QUERIES for c in convs }
for cand in [50,100,200,400,800,2000,100000]:
    tb=ti=0; lat=[]
    for q in QUERIES:
        for c in convs:
            bb=BASE[(q,c)]
            t0=time.perf_counter(); hh=[i for _,i in hybrid(c,q,cand=cand)]; lat.append((time.perf_counter()-t0)*1000)
            tb+=len(bb); ti+=len(set(bb)&set(hh))
    lat.sort()
    print(f"{cand:>6} {ti/max(tb,1)*100:>10.0f}% {statistics.median(lat):>12.2f}ms {lat[int(len(lat)*.95)-1]:>9.2f}ms")

print("\n=== comparacao final na maior conversa (3199 itens) ===")
c=convs[0]; bs=[];hs=[]
print(f"{'query':<26} {'atual':>9} {'hibrido':>10} {'ganho':>7}")
for q in QUERIES:
    xb=statistics.median([(lambda t0=time.perf_counter():(B.baseline(src,c,q),(time.perf_counter()-t0)*1000)[1])() for _ in range(11)])
    xh=statistics.median([(lambda t0=time.perf_counter():(hybrid(c,q,cand=800),(time.perf_counter()-t0)*1000)[1])() for _ in range(11)])
    bs.append(xb);hs.append(xh); print(f"{q:<26} {xb:>8.1f}ms {xh:>9.2f}ms {xb/xh:>6.0f}x")
print(f"{'MEDIANA':<26} {statistics.median(bs):>8.1f}ms {statistics.median(hs):>9.2f}ms {statistics.median(bs)/statistics.median(hs):>6.0f}x")
print(f"{'PIOR CASO':<26} {max(bs):>8.1f}ms {max(hs):>9.2f}ms")
