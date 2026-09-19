import sqlite3, time, statistics, os, json, sys
sys.path.insert(0,"/tmp/fts-bench")
SRC="/tmp/fts-bench/copia2.db"
src=sqlite3.connect(f"file:{SRC}?mode=ro",uri=True)
rows=src.execute("SELECT conversation_id,position,item_id,item_json FROM conversation_items LIMIT 4000").fetchall()

SQL_TEXT=open("/tmp/fts-bench/bench6.py").read().split('SQL_TEXT = """')[1].split('"""')[0]
TXT=lambda alias: SQL_TEXT.replace("item_json", f"{alias}.item_json")

DDL_TABLE="""CREATE TABLE conversation_items (conversation_id TEXT NOT NULL, position INTEGER NOT NULL,
 item_id TEXT NOT NULL, item_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (conversation_id, position));"""
UPSERT="""INSERT INTO conversation_items (conversation_id,position,item_id,item_json,revision,updated_at)
 VALUES (?,?,?,?,1,1) ON CONFLICT(conversation_id,position) DO UPDATE SET
 item_id=excluded.item_id,item_json=excluded.item_json,revision=excluded.revision,updated_at=excluded.updated_at"""

def montar(com_trigger):
    p="/tmp/fts-bench/trg.db"
    if os.path.exists(p): os.remove(p)
    d=sqlite3.connect(p); d.execute("PRAGMA journal_mode=WAL"); d.execute(DDL_TABLE)
    if com_trigger:
        d.execute("CREATE VIRTUAL TABLE item_fts USING fts5(conv_id UNINDEXED,item_id UNINDEXED,pos UNINDEXED,text,tokenize='unicode61 remove_diacritics 2')")
        d.execute(f"""CREATE TRIGGER ci_ai AFTER INSERT ON conversation_items BEGIN
          INSERT INTO item_fts(conv_id,item_id,pos,text)
          SELECT new.conversation_id,new.item_id,new.position,{TXT('new')} WHERE {TXT('new')} IS NOT NULL AND {TXT('new')}<>''; END""")
        d.execute(f"""CREATE TRIGGER ci_au AFTER UPDATE ON conversation_items BEGIN
          DELETE FROM item_fts WHERE conv_id=old.conversation_id AND pos=old.position;
          INSERT INTO item_fts(conv_id,item_id,pos,text)
          SELECT new.conversation_id,new.item_id,new.position,{TXT('new')} WHERE {TXT('new')} IS NOT NULL AND {TXT('new')}<>''; END""")
        d.execute("""CREATE TRIGGER ci_ad AFTER DELETE ON conversation_items BEGIN
          DELETE FROM item_fts WHERE conv_id=old.conversation_id AND pos=old.position; END""")
    return d,p

print("=== custo de escrita: carga inicial de 4000 itens (uma transacao) ===")
for com in (False,True):
    d,p=montar(com); t0=time.perf_counter()
    d.executemany(UPSERT,rows); d.commit()
    dt=time.perf_counter()-t0
    n=d.execute("SELECT count(*) FROM item_fts").fetchone()[0] if com else 0
    print(f"  {'COM trigger ' if com else 'SEM trigger '}: {dt*1000:>7.0f}ms  ({dt/len(rows)*1000:.3f}ms/item)"+(f"  indice={n} itens" if com else ""))
    d.close()

print("\n=== custo do caminho quente: re-upsert de 1 item (streaming) ===")
for com in (False,True):
    d,p=montar(com); d.executemany(UPSERT,rows); d.commit()
    alvo=rows[100]; xs=[]
    for i in range(200):
        r=(alvo[0],alvo[1],alvo[2],json.dumps({**json.loads(alvo[3]),"_v":i}))
        t0=time.perf_counter(); d.execute(UPSERT,r); d.commit(); xs.append((time.perf_counter()-t0)*1000)
    xs.sort()
    print(f"  {'COM trigger ' if com else 'SEM trigger '}: mediana {statistics.median(xs):.2f}ms  p95 {xs[int(len(xs)*.95)-1]:.2f}ms")
    if com:
        dup=d.execute("SELECT count(*) FROM item_fts WHERE conv_id=? AND pos=?",(alvo[0],alvo[1])).fetchone()[0]
        print(f"     -> apos 200 updates, o indice tem {dup} linha(s) para esse item (tem que ser 1)")
    d.close()

print("\n=== o trigger acompanha DELETE em massa (o 'position >= item_count')? ===")
d,p=montar(True); d.executemany(UPSERT,rows); d.commit()
antes=d.execute("SELECT count(*) FROM item_fts").fetchone()[0]
cv=rows[0][0]
d.execute("DELETE FROM conversation_items WHERE conversation_id=? AND position >= 50",(cv,)); d.commit()
depois=d.execute("SELECT count(*) FROM item_fts").fetchone()[0]
orfaos=d.execute("SELECT count(*) FROM item_fts f WHERE NOT EXISTS (SELECT 1 FROM conversation_items i WHERE i.conversation_id=f.conv_id AND i.position=f.pos)").fetchone()[0]
print(f"  indice antes={antes} depois={depois} | linhas orfas no indice: {orfaos} (tem que ser 0)")
