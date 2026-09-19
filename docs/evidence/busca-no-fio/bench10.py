import sqlite3, time, statistics, os, json, sys
sys.path.insert(0,"/tmp/fts-bench")
exec(open("/tmp/fts-bench/bench9.py").read().split("print(\"=== custo de escrita")[0])

print("=== DELETE em massa, agora com alvo que REALMENTE tem linhas ===")
d,p=montar(True); d.executemany(UPSERT,rows); d.commit()
cv=d.execute("SELECT conversation_id FROM conversation_items GROUP BY 1 ORDER BY count(*) DESC LIMIT 1").fetchone()[0]
n_tab=d.execute("SELECT count(*) FROM conversation_items WHERE conversation_id=?",(cv,)).fetchone()[0]
n_idx=d.execute("SELECT count(*) FROM item_fts WHERE conv_id=?",(cv,)).fetchone()[0]
print(f"  alvo {cv[:12]}: tabela={n_tab} indice={n_idx}")
d.execute("DELETE FROM conversation_items WHERE conversation_id=? AND position >= 50",(cv,)); d.commit()
n_tab2=d.execute("SELECT count(*) FROM conversation_items WHERE conversation_id=?",(cv,)).fetchone()[0]
n_idx2=d.execute("SELECT count(*) FROM item_fts WHERE conv_id=?",(cv,)).fetchone()[0]
orf=d.execute("SELECT count(*) FROM item_fts f WHERE NOT EXISTS (SELECT 1 FROM conversation_items i WHERE i.conversation_id=f.conv_id AND i.position=f.pos)").fetchone()[0]
print(f"  apos DELETE position>=50: tabela={n_tab2} (removeu {n_tab-n_tab2}) indice={n_idx2} (removeu {n_idx-n_idx2})")
print(f"  linhas orfas no indice: {orf}  {'OK' if orf==0 and n_tab-n_tab2>0 else 'FALHOU'}")

print("\n=== DELETE da conversa inteira (o cascade de apagar conversa) ===")
d.execute("DELETE FROM conversation_items WHERE conversation_id=?",(cv,)); d.commit()
rest=d.execute("SELECT count(*) FROM item_fts WHERE conv_id=?",(cv,)).fetchone()[0]
print(f"  sobrou no indice para essa conversa: {rest}  {'OK' if rest==0 else 'FALHOU'}")
d.close()

print("\n=== caminho quente REAL: N itens em UMA transacao (como o Rust faz) ===")
for n_itens in (1,10,50):
    for com in (False,True):
        d,p=montar(com); d.executemany(UPSERT,rows); d.commit()
        xs=[]
        for k in range(60):
            lote=[(r[0],r[1],r[2],json.dumps({**json.loads(r[3]),"_v":k})) for r in rows[100:100+n_itens]]
            t0=time.perf_counter()
            d.execute("BEGIN"); d.executemany(UPSERT,lote); d.commit()
            xs.append((time.perf_counter()-t0)*1000)
        xs.sort()
        print(f"  lote de {n_itens:>2} item(ns) {'COM' if com else 'SEM'} trigger: mediana {statistics.median(xs):>6.2f}ms  p95 {xs[int(len(xs)*.95)-1]:>6.2f}ms")
        d.close()
