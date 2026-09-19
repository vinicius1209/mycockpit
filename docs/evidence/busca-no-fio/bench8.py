import sqlite3, time, statistics, sys
sys.path.insert(0,"/tmp/fts-bench")
import bench as B
SRC="/tmp/fts-bench/copia2.db"; FTS="/tmp/fts-bench/fts_ext.db"
c=sqlite3.connect(f"file:{SRC}?mode=ro",uri=True); d=sqlite3.connect(f"file:{FTS}?mode=ro",uri=True)
STOP=set("a o os as um uma de do da dos das e ou que com sem por para pra no na nos nas em ao aos se ser foi the of to in on for and or with isso este esta esse essa mais menos".split())
def expr(q):
    ts=[t for t in B.tokens(q.lower()) if t not in STOP and len(t)>=3] or B.tokens(q.lower())
    return " OR ".join(f'"{t}"*' if len(t)>=4 else f'"{t}"' for t in ts)
TOT={k:(v or 1) for k,v in d.execute("SELECT conv_id,max(pos)+1 FROM fts GROUP BY conv_id")}
def hib(conv,q,limit=10,cand=800):
    ql=q.strip().lower(); terms=B.tokens(ql); total=max(TOT.get(conv,1),1); hits=[]
    for pos,text in d.execute("SELECT pos,text FROM fts WHERE fts MATCH ? AND conv_id=? ORDER BY rank LIMIT ?",(expr(q),conv,cand)):
        low=text.lower(); m=sum(1 for t in terms if t in low)
        if m==0 and ql not in low: continue
        hits.append(((8.0 if ql in low else 0.0)+(m/max(len(terms),1))*6.0+pos/total,pos))
    hits.sort(key=lambda x:-x[0]); return hits[:limit]
Q=["scroll","rolagem automatica","composer anexo","migration sqlite","erro de build","companion pareamento",
   "watchdog interval","drag and drop sidebar","custo do turno","styleguide elevacao","tauri command async","teste que quebrou"]
convs=[r[0] for r in d.execute("SELECT conv_id FROM fts GROUP BY 1 ORDER BY count(*) DESC LIMIT 3")]
BASE={(q,cv):[i for _,i in B.baseline(c,cv,q)] for q in Q for cv in convs}
print(f"{'cand':>7} {'fidelidade':>11} {'mediana':>9} {'p95':>8} {'pior':>8}")
for cand in [25,50,100,200,400,800,2000]:
    n=dn=0; lat=[]
    for q in Q:
        for cv in convs:
            t0=time.perf_counter(); hh=[i for _,i in hib(cv,q,cand=cand)]; lat.append((time.perf_counter()-t0)*1000)
            bb=BASE[(q,cv)]; n+=len(set(bb)&set(hh)); dn+=len(bb)
    lat.sort()
    print(f"{cand:>7} {n/max(dn,1)*100:>10.1f}% {statistics.median(lat):>7.2f}ms {lat[int(len(lat)*.95)-1]:>6.2f}ms {lat[-1]:>6.2f}ms")
