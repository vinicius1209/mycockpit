// Formatadores compartilhados (custo / bytes / duração / tokens) + extração de
// JSON embutido em texto de modelo. Extraídos de call sites que reimplementavam
// as mesmas funções, comportamento idêntico ao original de cada lugar.

import type { CostSource } from "@/lib/agent"

export const BYTES_PER_MB = 1024 * 1024

/** Custo em US$, formato pt-BR (vírgula decimal): "US$ 12,00", "US$ 0,043".
 *  3 casas com ponto ("US$12.000") lia-se DOZE MIL em pt-BR — bug real.
 *  Precisão adaptativa: ≥ 1 → 2 casas; < 1 → 3 (não esconde custo sub-centavo).
 *  "" se ausente; prefixo "~" quando estimado. */
export function fmtCost(c: number | undefined, source?: CostSource | string): string {
  if (c == null) return ""
  const decimals = c >= 1 ? 2 : 3
  const num = c.toFixed(decimals).replace(".", ",")
  return `${source === "estimated" ? "~" : ""}US$ ${num}`
}

/** Soma dos custos dos candidatos de um Fusion (custo ao vivo da disputa). */
export function liveCostOf(fusion: {
  candidates: { costUsd?: number }[]
}): number {
  return fusion.candidates.reduce((a, c) => a + (c.costUsd ?? 0), 0)
}

/** Duração em ms → "12s", "26min 41s", "1h 05min". Com unidade explícita:
 *  "26:41" era ambíguo (min:s? h:min?). */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}min ${String(s % 60).padStart(2, "0")}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, "0")}min`
}

/** Contagem de tokens → "950", "1.2k", "12k", "3.1M". */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

/** Tamanho em bytes → "512 B" / "1.5 KB" / "2.3 MB". */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < BYTES_PER_MB) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / BYTES_PER_MB).toFixed(1)} MB`
}

/** Extrai o 1º bloco JSON (`array` `[...]` ou `object` `{...}`) embutido em `text`.
 *  Retorna o valor parseado ou null (texto sem JSON / JSON malformado). */
export function extractJson<T>(text: string, kind: "array" | "object"): T | null {
  const re = kind === "array" ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/
  const m = text.match(re)
  if (!m) return null
  try {
    return JSON.parse(m[0]) as T
  } catch {
    return null
  }
}
