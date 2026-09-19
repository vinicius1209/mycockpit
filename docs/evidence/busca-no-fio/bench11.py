import sqlite3, time, os, json, sys
sys.path.insert(0,"/tmp/fts-bench")
exec(open("/tmp/fts-bench/bench9.py").read().split("print(\"=== custo de escrita")[0])
src2=sqlite3.connect("file:/tmp/fts-bench/copia2.db?mode=ro",uri=True)
cv=src2.execute("SELECT conversation_id FROM conversation_items GROUP BY 1 ORDER BY count(*) DESC LIMIT 1").fetchone()[0]
big=src2.execute("SELECT conversation_id,position,item_id,item_json FROM conversation_items WHERE conversation_id=?",(cv,)).fetchall()
print(f"conversa alvo: {cv[:12]} com {len(big)} itens\n")
print("=== o que o persist faz HOJE: replaceAll = DELETE tudo + INSERT tudo ===")
for com in (False,True):
    d,p=montar(com)
    d.execute("BEGIN"); d.executemany(UPSERT,big); d.commit()   # carga inicial
    ts=[]
    for _ in range(3):
        t0=time.perf_counter()
        d.execute("BEGIN")
        d.execute("DELETE FROM conversation_items WHERE conversation_id=?",(cv,))
        d.executemany(UPSERT,big)
        d.commit()
        ts.append((time.perf_counter()-t0)*1000)
    idx=d.execute("SELECT count(*) FROM item_fts").fetchone()[0] if com else 0
    print(f"  {'COM trigger' if com else 'SEM trigger'}: {min(ts):>8.0f}ms  (melhor de 3)"+(f"   indice={idx}" if com else ""))
    if com:
        print(f"     tamanho do arquivo apos 4 reindexacoes: {os.path.getsize(p)/1024/1024:.1f} MB")
        d.execute("INSERT INTO item_fts(item_fts) VALUES('optimize')"); d.commit()
        print(f"     apos optimize: {os.path.getsize(p)/1024/1024:.1f} MB")
    d.close()

print("\n=== alternativa: indexar so o que MUDOU (sem replaceAll disparando trigger) ===")
d,p=montar(True)
d.execute("BEGIN"); d.executemany(UPSERT,big); d.commit()
t0=time.perf_counter()
d.execute("BEGIN"); d.executemany(UPSERT,big[-3:]); d.commit()   # so a cauda
print(f"  upsert da cauda (3 itens) com trigger: {(time.perf_counter()-t0)*1000:.1f}ms")
d.close()
