// Diff por LINHA (LCS) p/ os cartões de Edit/Write no chat. Entradas são os
// snippets do tool (old_string/new_string), normalmente pequenos — LCS O(n·m)
// dá conta. Guard contra patológicos (arquivo gigante) cai pro naïve.

export type DiffRow = { type: "ctx" | "add" | "del"; text: string }

export interface LineDiff {
  rows: DiffRow[]
  added: number
  removed: number
}

const MAX_CELLS = 250_000 // ~500×500 linhas; acima disso, naïve (del+add)

export function lineDiff(oldText: string, newText: string): LineDiff {
  const a = oldText.length ? oldText.split("\n") : []
  const b = newText.length ? newText.split("\n") : []
  const n = a.length
  const m = b.length

  // naïve: sem base comum ou grande demais → tudo removido + tudo adicionado.
  if (n === 0 || m === 0 || n * m > MAX_CELLS) {
    const rows: DiffRow[] = [
      ...a.map((t) => ({ type: "del" as const, text: t })),
      ...b.map((t) => ({ type: "add" as const, text: t })),
    ]
    return { rows, added: m, removed: n }
  }

  // LCS (DP de trás pra frente).
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  )
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  let added = 0
  let removed = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: "ctx", text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: "del", text: a[i] })
      i++
      removed++
    } else {
      rows.push({ type: "add", text: b[j] })
      j++
      added++
    }
  }
  while (i < n) {
    rows.push({ type: "del", text: a[i++] })
    removed++
  }
  while (j < m) {
    rows.push({ type: "add", text: b[j++] })
    added++
  }
  return { rows, added, removed }
}

/** Corta contexto EXTERNO (antes da 1ª e depois da última mudança) p/ `pad`
 *  linhas — deixa o diff enxuto, estilo Warp. Contexto interno fica intacto. */
export function trimOuterContext(rows: DiffRow[], pad = 3): DiffRow[] {
  const first = rows.findIndex((r) => r.type !== "ctx")
  if (first === -1) return rows.slice(0, pad * 2) // sem mudança (raro)
  let last = rows.length - 1
  while (last >= 0 && rows[last].type === "ctx") last--
  return rows.slice(Math.max(0, first - pad), Math.min(rows.length, last + 1 + pad))
}
