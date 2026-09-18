# Benchmark: busca atual (blob + scan) vs FTS5, sobre copia do banco real.
import sqlite3, json, time, statistics, os, sys

SRC = "/tmp/fts-bench/copia.db"  # SEMPRE uma copia; nunca o banco vivo
FTS = "/tmp/fts-bench/fts.db"

# --- porte fiel de searchable_text() de context_gateway.rs:484 ---
def searchable_text(it):
    k = it.get("kind", "")
    if k in ("user", "text", "advice"):
        return it.get("text") or ""
    if k in ("error", "notice", "limit"):
        return it.get("message") or ""
    if k == "tool":
        name = it.get("name") or "tool"
        inp = json.dumps(it.get("input"), ensure_ascii=False) if "input" in it else "null"
        res = ((it.get("result") or {}).get("text")) if isinstance(it.get("result"), dict) else ""
        return f"{name} {inp} {res or ''}"
    if k == "result":
        return it.get("text") or ""
    return ""

# --- porte fiel de tokens() de context_gateway.rs:514 ---
def tokens(s):
    out, cur = [], []
    for c in s:
        if c.isalnum() or c in "_-":
            cur.append(c)
        else:
            if len(cur) >= 2: out.append("".join(cur))
            cur = []
    if len(cur) >= 2: out.append("".join(cur))
    return out

MAX_RESULTS = 10

# --- BASELINE: exatamente o que search_conversation faz hoje ---
def baseline(conn, conv, query, limit=MAX_RESULTS):
    row = conn.execute("SELECT items FROM conversations WHERE id=?", (conv,)).fetchone()
    items = json.loads(row[0])
    ql = query.strip().lower()
    terms = tokens(ql)
    total = max(len(items), 1)
    hits = []
    for index, it in enumerate(items):
        text = searchable_text(it)
        if not text: continue
        lower = text.lower()
        matched = sum(1 for t in terms if t in lower)
        if matched == 0 and ql not in lower: continue
        exact = 8.0 if ql in lower else 0.0
        score = exact + (matched / max(len(terms),1)) * 6.0 + index/total
        hits.append((score, index))
    hits.sort(key=lambda x: -x[0])
    return hits[:limit]

# --- construcao do indice FTS5 ---
def build_fts(verbose=True):
    if os.path.exists(FTS): os.remove(FTS)
    src = sqlite3.connect(f"file:{SRC}?mode=ro", uri=True)
    dst = sqlite3.connect(FTS)
    dst.execute("PRAGMA journal_mode=WAL")
    # contentless-ish: guardamos o texto pra poder devolver o summary sem abrir o blob
    dst.execute("""CREATE VIRTUAL TABLE item_fts USING fts5(
        conv_id UNINDEXED, item_id UNINDEXED, item_index UNINDEXED, kind UNINDEXED,
        text, tokenize='unicode61 remove_diacritics 2')""")
    t0 = time.perf_counter()
    n = 0
    for conv_id, blob in src.execute("SELECT id, items FROM conversations"):
        items = json.loads(blob)
        rows = []
        for i, it in enumerate(items):
            txt = searchable_text(it)
            if not txt: continue
            rows.append((conv_id, it.get("id"), i, it.get("kind",""), txt))
        dst.executemany("INSERT INTO item_fts VALUES (?,?,?,?,?)", rows)
        n += len(rows)
    dst.commit()
    dst.execute("INSERT INTO item_fts(item_fts) VALUES('optimize')")
    dst.commit()
    t1 = time.perf_counter()
    if verbose:
        print(f"indice FTS5: {n} itens indexados em {t1-t0:.2f}s")
    src.close(); dst.close()
    return n, t1-t0

def fts_query(conn, conv, query, limit=MAX_RESULTS, prefix=True):
    ts = tokens(query.lower())
    if not ts: return []
    # OR entre termos (o baseline tambem casa parcial), prefix pra imitar o `contains`
    expr = " OR ".join(f'"{t}"*' if prefix else f'"{t}"' for t in ts)
    return conn.execute(
        "SELECT item_index, rank FROM item_fts WHERE item_fts MATCH ? AND conv_id=? "
        "ORDER BY rank LIMIT ?", (expr, conv, limit)).fetchall()

def med(fn, reps):
    xs = []
    for _ in range(reps):
        t0 = time.perf_counter(); fn(); xs.append((time.perf_counter()-t0)*1000)
    return statistics.median(xs)

if __name__ == "__main__":
    build_fts()
    print(f"tamanho do indice: {os.path.getsize(FTS)/1024/1024:.1f} MB")
    print(f"tamanho do banco:  {os.path.getsize(SRC)/1024/1024:.1f} MB\n")

    src = sqlite3.connect(f"file:{SRC}?mode=ro", uri=True)
    fts = sqlite3.connect(f"file:{FTS}?mode=ro", uri=True)

    convs = src.execute(
        "SELECT id, json_array_length(items), length(items) FROM conversations "
        "ORDER BY length(items) DESC").fetchall()

    QUERIES = ["scroll", "rolagem automatica", "composer anexo", "migration sqlite",
               "erro de build", "companion pareamento"]
    REPS = 15

    print(f"{'itens':>6} {'blob':>8} | {'query':<24} {'atual':>9} {'fts5':>8} {'ganho':>8}")
    print("-"*72)
    rows=[]
    for cid, nitems, blen in convs[:6]:
        for q in QUERIES:
            b = med(lambda: baseline(src, cid, q), REPS)
            f = med(lambda: fts_query(fts, cid, q), REPS)
            rows.append((nitems, b, f))
            print(f"{nitems:>6} {blen/1024:>7.0f}K | {q:<24} {b:>8.1f}ms {f:>7.2f}ms {b/f:>7.0f}x")
    print("-"*72)
    bs=[r[1] for r in rows]; fs=[r[2] for r in rows]
    print(f"mediana geral: atual {statistics.median(bs):.1f}ms | fts5 {statistics.median(fs):.2f}ms "
          f"| ganho {statistics.median(bs)/statistics.median(fs):.0f}x")
