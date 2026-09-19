# Double check: o blob nao e mais a unica fonte. Existe conversation_items (migracao 48).
import sqlite3, json, time, statistics, os, sys
sys.path.insert(0,"/tmp/fts-bench")
import bench as B

SRC="/tmp/fts-bench/copia2.db"
c=sqlite3.connect(f"file:{SRC}?mode=ro",uri=True)

print("=== FRESCOR: o blob esta atrasado em relacao a tabela? ===")
rows=c.execute("""SELECT c.id, json_array_length(c.items),
  (SELECT count(*) FROM conversation_items i WHERE i.conversation_id=c.id)
  FROM conversations c""").fetchall()
atrasadas=[(i,b,t) for i,b,t in rows if t and t!=b]
print(f"  {len(rows)} conversas | {sum(1 for _,_,t in rows if t)} na tabela nova | {len(atrasadas)} divergentes")
for i,b,t in atrasadas: print(f"    {i[:12]}: blob={b} tabela={t}  (blob atrasado em {t-b})")

# --- CAMINHO 2: ler conversation_items em vez do blob, mesmo score ---
def por_tabela(conv,query,limit=10):
    ql=query.strip().lower(); terms=B.tokens(ql)
    rs=c.execute("SELECT position,item_json FROM conversation_items WHERE conversation_id=? ORDER BY position",(conv,)).fetchall()
    total=max(len(rs),1); hits=[]
    for pos,ij in rs:
        text=B.searchable_text(json.loads(ij))
        if not text: continue
        low=text.lower()
        m=sum(1 for t in terms if t in low)
        if m==0 and ql not in low: continue
        hits.append(((8.0 if ql in low else 0.0)+(m/max(len(terms),1))*6.0+pos/total,pos))
    hits.sort(key=lambda x:-x[0]); return hits[:limit]

# --- CAMINHO 3: FTS5 external content sobre conversation_items ---
FTS="/tmp/fts-bench/fts_ext.db"
if os.path.exists(FTS): os.remove(FTS)
d=sqlite3.connect(FTS)
d.execute(f"ATTACH DATABASE 'file:{SRC}?mode=ro' AS src")
# extracao de texto em SQL puro, espelhando searchable_text() do Rust
SQL_TEXT = """CASE json_extract(item_json,'$.kind')
  WHEN 'user' THEN json_extract(item_json,'$.text')
  WHEN 'text' THEN json_extract(item_json,'$.text')
  WHEN 'advice' THEN json_extract(item_json,'$.text')
  WHEN 'result' THEN json_extract(item_json,'$.text')
  WHEN 'error' THEN json_extract(item_json,'$.message')
  WHEN 'notice' THEN json_extract(item_json,'$.message')
  WHEN 'limit' THEN json_extract(item_json,'$.message')
  WHEN 'tool' THEN coalesce(json_extract(item_json,'$.name'),'tool')||' '||
       coalesce(json_extract(item_json,'$.input'),'')||' '||
       coalesce(json_extract(item_json,'$.result.text'),'')
  ELSE NULL END"""
d.execute("CREATE VIRTUAL TABLE fts USING fts5(conv_id UNINDEXED,item_id UNINDEXED,pos UNINDEXED,text,tokenize='unicode61 remove_diacritics 2')")
t0=time.perf_counter()
d.execute(f"INSERT INTO fts(conv_id,item_id,pos,text) SELECT conversation_id,item_id,position,{SQL_TEXT} FROM src.conversation_items WHERE {SQL_TEXT} IS NOT NULL AND {SQL_TEXT}<>''")
d.commit(); d.execute("INSERT INTO fts(fts) VALUES('optimize')"); d.commit()
n=d.execute("SELECT count(*) FROM fts").fetchone()[0]
print(f"\n=== indice FTS5 direto de conversation_items, em SQL puro ===")
print(f"  {n} itens em {time.perf_counter()-t0:.2f}s | {os.path.getsize(FTS)/1024/1024:.1f} MB")

STOP=set("a o os as um uma de do da dos das e ou que com sem por para pra no na nos nas em ao aos se ser foi the of to in on for and or with isso este esta esse essa mais menos".split())
def expr(q):
    ts=[t for t in B.tokens(q.lower()) if t not in STOP and len(t)>=3] or B.tokens(q.lower())
    return " OR ".join(f'"{t}"*' if len(t)>=4 else f'"{t}"' for t in ts)
TOT={k:(v or 1) for k,v in d.execute("SELECT conv_id,max(pos)+1 FROM fts GROUP BY conv_id")}
def hibrido(conv,q,limit=10,cand=800):
    ql=q.strip().lower(); terms=B.tokens(ql); total=max(TOT.get(conv,1),1); hits=[]
    for pos,text in d.execute("SELECT pos,text FROM fts WHERE fts MATCH ? AND conv_id=? ORDER BY rank LIMIT ?",(expr(q),conv,cand)):
        low=text.lower(); m=sum(1 for t in terms if t in low)
        if m==0 and ql not in low: continue
        hits.append(((8.0 if ql in low else 0.0)+(m/max(len(terms),1))*6.0+pos/total,pos))
    hits.sort(key=lambda x:-x[0]); return hits[:limit]

CONV=c.execute("SELECT conversation_id FROM conversation_items GROUP BY 1 ORDER BY count(*) DESC LIMIT 1").fetchone()[0]
Q=["scroll","rolagem automatica","composer anexo","migration sqlite","erro de build","companion pareamento",
   "watchdog interval","drag and drop sidebar","custo do turno","styleguide elevacao","tauri command async","teste que quebrou"]
def med(fn,r=9):
    xs=[]
    for _ in range(r):
        t0=time.perf_counter(); fn(); xs.append((time.perf_counter()-t0)*1000)
    return statistics.median(xs)

print(f"\n=== 3 caminhos na maior conversa ({TOT.get(CONV)} itens) ===")
print(f"{'query':<24}{'1 blob(hoje)':>14}{'2 tabela':>11}{'3 fts5':>10}   fidelidade 3 vs 1")
b_=[];t_=[];f_=[];fid_n=fid_d=0
for q in Q:
    xb=med(lambda:B.baseline(c,CONV,q)); xt=med(lambda:por_tabela(CONV,q)); xf=med(lambda:hibrido(CONV,q))
    bb={i for _,i in B.baseline(c,CONV,q)}; ff={i for _,i in hibrido(CONV,q)}
    fid_n+=len(bb&ff); fid_d+=len(bb)
    b_.append(xb);t_.append(xt);f_.append(xf)
    print(f"{q:<24}{xb:>12.1f}ms{xt:>9.1f}ms{xf:>8.2f}ms{len(bb&ff)/max(len(bb),1)*100:>15.0f}%")
print(f"{'MEDIANA':<24}{statistics.median(b_):>12.1f}ms{statistics.median(t_):>9.1f}ms{statistics.median(f_):>8.2f}ms{fid_n/max(fid_d,1)*100:>15.0f}%")
