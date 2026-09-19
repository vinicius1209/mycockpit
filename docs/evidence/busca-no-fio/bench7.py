# O risco real: a extracao em SQL espelha searchable_text() do Rust?
import sqlite3, json, sys
sys.path.insert(0,"/tmp/fts-bench")
import bench as B

SRC="/tmp/fts-bench/copia2.db"
c=sqlite3.connect(f"file:{SRC}?mode=ro",uri=True)
SQL_TEXT=open("/tmp/fts-bench/bench6.py").read().split('SQL_TEXT = """')[1].split('"""')[0]

rows=c.execute(f"SELECT item_json, {SQL_TEXT} FROM conversation_items").fetchall()
print(f"comparando {len(rows)} itens: extracao SQL vs porte fiel do Rust\n")
igual=dif=0; por_kind={}; exemplos=[]
for ij, sql_txt in rows:
    it=json.loads(ij)
    rust_txt=B.searchable_text(it)
    s=(sql_txt or ""); r=(rust_txt or "")
    k=it.get("kind","?")
    if s==r: igual+=1
    else:
        dif+=1; por_kind[k]=por_kind.get(k,0)+1
        if len(exemplos)<4: exemplos.append((k,r[:90],s[:90]))
print(f"  identicos: {igual}  |  divergentes: {dif}  ({dif/len(rows)*100:.1f}%)")
if por_kind:
    print(f"  divergencia por kind: {por_kind}")
    for k,r,s in exemplos:
        print(f"\n  kind={k}\n    rust: {r!r}\n    sql : {s!r}")
