import sqlite3, time, statistics, json
import bench as B

STOP = set("a o os as um uma uns umas de do da dos das e ou que com sem por para pra pro no na nos nas em ao aos se ser foi the of to in on for and or with isso este esta esse essa mais menos".split())
def expr(q):
    ts=[t for t in B.tokens(q.lower()) if t not in STOP and len(t)>=3]
    if not ts: ts=B.tokens(q.lower())
    return " OR ".join(f'"{t}"*' if len(t)>=4 else f'"{t}"' for t in ts)

src=sqlite3.connect(f"file:{B.SRC}?mode=ro",uri=True)
fts=sqlite3.connect(f"file:{B.FTS}?mode=ro",uri=True)

# HIBRIDO: FTS5 gera candidatos (com o texto ja no indice), o SCORE ATUAL rankeia.
def hybrid(conv,q,limit=10,cand=200):
    ql=q.strip().lower(); terms=B.tokens(ql)
    total=max(src.execute("SELECT json_array_length(items) FROM conversations WHERE id=?",(conv,)).fetchone()[0],1)
    rows=fts.execute("SELECT item_index,text FROM item_fts WHERE item_fts MATCH ? AND conv_id=? "
                     "ORDER BY rank LIMIT ?",(expr(q),conv,cand)).fetchall()
    hits=[]
    for index,text in rows:
        lower=text.lower()
        matched=sum(1 for t in terms if t in lower)
        if matched==0 and ql not in lower: continue
        score=(8.0 if ql in lower else 0.0)+(matched/max(len(terms),1))*6.0+index/total
        hits.append((score,index))
    hits.sort(key=lambda x:-x[0])
    return hits[:limit]

QUERIES=["scroll","rolagem automatica","composer anexo","migration sqlite","erro de build",
         "companion pareamento","watchdog interval","drag and drop sidebar","custo do turno",
         "styleguide elevacao","tauri command async","teste que quebrou"]
convs=[r[0] for r in src.execute("SELECT id FROM conversations ORDER BY length(items) DESC LIMIT 3")]

print("=== FIDELIDADE do hibrido vs busca atual (top-10) ===")
print(f"{'query':<26} {'atual':>6} {'hib':>5} {'iguais':>7} {'fidelid.':>9}")
tb=ti=0
for q in QUERIES:
    b_all=h_all=inter=0
    for c in convs:
        bb=[i for _,i in B.baseline(src,c,q)]
        hh=[i for _,i in hybrid(c,q)]
        b_all+=len(bb); h_all+=len(hh); inter+=len(set(bb)&set(hh))
    tb+=b_all; ti+=inter
    print(f"{q:<26} {b_all:>6} {h_all:>5} {inter:>7} {inter/max(b_all,1)*100:>8.0f}%")
print(f"{'TOTAL':<26} {tb:>6} {'':>5} {ti:>7} {ti/max(tb,1)*100:>8.0f}%")

print("\n=== o que o hibrido PERDE: itens que so o substring acha (match no meio da palavra) ===")
miss=0; tot=0; ex=[]
for q in QUERIES:
    for c in convs:
        bb={i for _,i in B.baseline(src,c,q)}
        hh={i for _,i in hybrid(c,q,limit=10,cand=100000)}  # candidatos ilimitados
        tot+=len(bb); d=bb-hh; miss+=len(d)
        if d and len(ex)<3: ex.append((q,sorted(d)[:3]))
print(f"  com candidatos ILIMITADOS, o hibrido ainda perde {miss}/{tot} ({miss/max(tot,1)*100:.0f}%) dos hits do atual")
print(f"  exemplos: {ex}")

print("\n=== VELOCIDADE do hibrido ===")
print(f"{'query':<26} {'atual':>9} {'hibrido':>9} {'ganho':>7}")
bs=[];hs=[]
for q in QUERIES:
    c=convs[0]
    xb=statistics.median([ (lambda t0=time.perf_counter(): (B.baseline(src,c,q),(time.perf_counter()-t0)*1000)[1])() for _ in range(9)])
    xh=statistics.median([ (lambda t0=time.perf_counter(): (hybrid(c,q),(time.perf_counter()-t0)*1000)[1])() for _ in range(9)])
    bs.append(xb);hs.append(xh)
    print(f"{q:<26} {xb:>8.1f}ms {xh:>8.2f}ms {xb/xh:>6.0f}x")
print(f"{'MEDIANA':<26} {statistics.median(bs):>8.1f}ms {statistics.median(hs):>8.2f}ms {statistics.median(bs)/statistics.median(hs):>6.0f}x")
