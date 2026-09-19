import sqlite3, time, os, json, sys
sys.path.insert(0,"/tmp/fts-bench")
exec(open("/tmp/fts-bench/bench9.py").read().split("print(\"=== custo de escrita")[0])
src2=sqlite3.connect("file:/tmp/fts-bench/copia2.db?mode=ro",uri=True)
cv=src2.execute("SELECT conversation_id FROM conversation_items GROUP BY 1 ORDER BY count(*) DESC LIMIT 1").fetchone()[0]
big=src2.execute("SELECT conversation_id,position,item_id,item_json FROM conversation_items WHERE conversation_id=?",(cv,)).fetchall()

def montar_guardado():
    p="/tmp/fts-bench/trg2.db"
    if os.path.exists(p): os.remove(p)
    d=sqlite3.connect(p); d.execute("PRAGMA journal_mode=WAL"); d.execute(DDL_TABLE)
    d.execute("CREATE VIRTUAL TABLE item_fts USING fts5(conv_id UNINDEXED,item_id UNINDEXED,pos UNINDEXED,text,tokenize='unicode61 remove_diacritics 2')")
    d.execute(f"""CREATE TRIGGER ci_ai AFTER INSERT ON conversation_items BEGIN
      INSERT INTO item_fts(conv_id,item_id,pos,text) SELECT new.conversation_id,new.item_id,new.position,{TXT('new')}
      WHERE {TXT('new')} IS NOT NULL AND {TXT('new')}<>''; END""")
    # GUARDA: so reindexa se o texto do item REALMENTE mudou
    d.execute(f"""CREATE TRIGGER ci_au AFTER UPDATE ON conversation_items
      WHEN old.item_json IS NOT new.item_json BEGIN
      DELETE FROM item_fts WHERE conv_id=old.conversation_id AND pos=old.position;
      INSERT INTO item_fts(conv_id,item_id,pos,text) SELECT new.conversation_id,new.item_id,new.position,{TXT('new')}
      WHERE {TXT('new')} IS NOT NULL AND {TXT('new')}<>''; END""")
    d.execute("""CREATE TRIGGER ci_ad AFTER DELETE ON conversation_items BEGIN
      DELETE FROM item_fts WHERE conv_id=old.conversation_id AND pos=old.position; END""")
    return d,p

print(f"conversa de {len(big)} itens\n")
print("=== replaceAll SEM o DELETE inicial (upsert idempotente) + trigger com guarda ===")
d,p=montar_guardado()
t0=time.perf_counter(); d.execute("BEGIN"); d.executemany(UPSERT,big); d.commit()
print(f"  carga inicial:            {(time.perf_counter()-t0)*1000:>8.0f}ms")
ts=[]
for _ in range(3):
    t0=time.perf_counter()
    d.execute("BEGIN"); d.executemany(UPSERT,big)
    d.execute("DELETE FROM conversation_items WHERE conversation_id=? AND position>=?",(cv,len(big)))
    d.commit(); ts.append((time.perf_counter()-t0)*1000)
print(f"  persist seguinte (nada mudou): {min(ts):>5.0f}ms   <-- era 3310ms com DELETE inicial")
idx=d.execute("SELECT count(*) FROM item_fts").fetchone()[0]
print(f"  indice: {idx} itens | arquivo {os.path.getsize(p)/1024/1024:.1f} MB")

print("\n=== e quando a cauda REALMENTE muda (o caso de todo turno)? ===")
for n in (1,3,10):
    lote=[(r[0],r[1],r[2],json.dumps({**json.loads(r[3]),"_v":time.time()})) for r in big[-n:]]
    t0=time.perf_counter()
    d.execute("BEGIN"); d.executemany(UPSERT,big[:-n]); d.executemany(UPSERT,lote); d.commit()
    print(f"  persist com {n:>2} item(ns) alterado(s) entre {len(big)}: {(time.perf_counter()-t0)*1000:>6.0f}ms")

print("\n=== consistencia: o indice bate com a tabela? ===")
orf=d.execute("SELECT count(*) FROM item_fts f WHERE NOT EXISTS (SELECT 1 FROM conversation_items i WHERE i.conversation_id=f.conv_id AND i.position=f.pos)").fetchone()[0]
falt=d.execute(f"SELECT count(*) FROM conversation_items i WHERE {TXT('i')} IS NOT NULL AND {TXT('i')}<>'' AND NOT EXISTS (SELECT 1 FROM item_fts f WHERE f.conv_id=i.conversation_id AND f.pos=i.position)").fetchone()[0]
dup=d.execute("SELECT count(*) FROM (SELECT conv_id,pos FROM item_fts GROUP BY 1,2 HAVING count(*)>1)").fetchone()[0]
print(f"  orfas={orf}  faltando={falt}  duplicadas={dup}   {'OK' if orf==falt==dup==0 else 'FALHOU'}")
d.close()
