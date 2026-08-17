// ADR-033 — usage ACUMULADO por thread: o lado PURO.
//
// Alguns motores (hoje o `codex exec`) reportam, no fim do turno, o total de
// tokens da THREAD inteira, não do turno. O runner (Rust) já normaliza para
// delta usando o baseline que ESTE módulo persiste por thread; aqui ficam as
// duas peças puras, testáveis sem banco:
//
//  1. `nextBaseline` — o acumulado que o próximo run precisa receber;
//  2. `planUsageRecompute` — a reconstrução do histórico gravado ANTES da
//     correção (cada linha guardou o acumulado; o gasto do turno é a diferença
//     para a linha anterior da mesma conversa).
//
// Custo e tokens são LINEARES no acumulado (mesma tabela de preço no turno
// inteiro), então a diferença de custo entre duas linhas seguidas é o custo do
// delta. Por isso a reconstrução NÃO precisa da tabela de preços — nada de
// duplicar $/1M no front.

/** Acumulado de tokens de uma thread (espelha `CumulativeUsage` no Rust). */
export interface CumulativeUsage {
  /** Input TOTAL (inclui a parte cacheada, convenção da API da OpenAI). */
  input: number
  cached_input: number
  output: number
}

export const ZERO_USAGE: CumulativeUsage = {
  input: 0,
  cached_input: 0,
  output: 0,
}

/** O acumulado que o provider acabou de reportar vira o baseline do próximo
 *  turno. Contador que anda pra trás (thread nova, reset) é aceito como está:
 *  é a verdade do provider dali em diante. */
export function nextBaseline(echoed: CumulativeUsage): CumulativeUsage {
  return {
    input: Math.max(0, Math.trunc(echoed.input || 0)),
    cached_input: Math.max(0, Math.trunc(echoed.cached_input || 0)),
    output: Math.max(0, Math.trunc(echoed.output || 0)),
  }
}

/** ADR-047 — o que MERECE uma linha no ledger de custo.
 *
 *  Até aqui os três writers de `turn_costs` (chat, disputa, fase de missão)
 *  gravavam só com `cost_usd != null`, e "não sei o preço" apagava o turno
 *  inteiro: o Antigravity rodou 5 turnos e ~7,3M de tokens sem deixar UMA
 *  linha (incidente 2026-08-16 §6). Consumo é fato medido; preço é dado
 *  externo que pode faltar. Então a régua passa a ser: gravou tokens, entra —
 *  com `costUsd` NULL, que é "não sei quanto custou", diferente de US$ 0,00.
 *
 *  O piso continua existindo: result sem custo E sem token nenhum não vira
 *  linha (seria uma linha que não descreve consumo algum). */
export function worthLedgerRow(r: {
  costUsd: number | null | undefined
  input: number | null | undefined
  output: number | null | undefined
  cache: number | null | undefined
}): boolean {
  if (r.costUsd != null) return true
  return (r.input ?? 0) > 0 || (r.output ?? 0) > 0 || (r.cache ?? 0) > 0
}

/** Uma linha do ledger como está no banco (pré-correção = acumulado). */
export interface RawCostRow {
  runId: string
  convId: string
  costUsd: number | null
  input: number
  output: number
  cache: number
  createdAt: number
}

/** A mesma linha, com o gasto DO TURNO. */
export interface RecomputedCostRow extends RawCostRow {
  /** Valores originais, preservados pra auditoria/backup (nada é apagado). */
  raw: { costUsd: number | null; input: number; output: number; cache: number }
}

/** Reconstrói o gasto por turno de linhas gravadas como acumulado.
 *
 *  Regra, por conversa e em ordem cronológica:
 *  - a PRIMEIRA linha vale inteira (o acumulado dela inclui os turnos que
 *    aconteceram antes do ledger existir — dinheiro que foi gasto de verdade,
 *    só concentrado numa linha);
 *  - linha seguinte = diferença para a anterior;
 *  - se QUALQUER campo diminuiu, a série recomeçou (thread nova na mesma
 *    conversa) e a linha volta a valer inteira.
 *
 *  Nunca inventa custo: a soma reconstruída é sempre ≤ a soma original. */
export function planUsageRecompute(rows: RawCostRow[]): RecomputedCostRow[] {
  const byConv = new Map<string, RawCostRow[]>()
  for (const r of rows) {
    const list = byConv.get(r.convId)
    if (list) list.push(r)
    else byConv.set(r.convId, [r])
  }
  const out: RecomputedCostRow[] = []
  for (const list of byConv.values()) {
    const ordered = [...list].sort(
      (a, b) => a.createdAt - b.createdAt || a.runId.localeCompare(b.runId),
    )
    let prev: RawCostRow | null = null
    for (const r of ordered) {
      const restarted =
        prev != null &&
        (r.input < prev.input ||
          r.output < prev.output ||
          r.cache < prev.cache ||
          // custo só depõe quando os DOIS lados têm preço: com linhas sem
          // preço no meio (ADR-047), ler NULL como zero fingia "a thread
          // reiniciou" e devolvia os tokens da linha INTEIROS ao turno.
          (r.costUsd != null &&
            prev.costUsd != null &&
            r.costUsd < prev.costUsd))
      const base = prev && !restarted ? prev : null
      out.push({
        ...r,
        input: r.input - (base?.input ?? 0),
        output: r.output - (base?.output ?? 0),
        cache: r.cache - (base?.cache ?? 0),
        // Linha anterior SEM preço (ADR-047): o delta de custo é desconhecido,
        // e `- 0` cobraria o acumulado inteiro de novo. Fica null — "não sei",
        // com os tokens do turno já corretos ao lado. Mesma escolha do ADR-033:
        // errar pra baixo, nunca pra cima.
        costUsd:
          r.costUsd == null
            ? null
            : base == null
              ? r.costUsd
              : base.costUsd == null
                ? null
                : Math.max(0, r.costUsd - base.costUsd),
        raw: {
          costUsd: r.costUsd,
          input: r.input,
          output: r.output,
          cache: r.cache,
        },
      })
      prev = r
    }
  }
  return out
}

/** Resumo humano da reconstrução (o que a UI mostra antes/depois). */
export function recomputeSummary(rows: RecomputedCostRow[]): {
  rows: number
  before: number
  after: number
} {
  let before = 0
  let after = 0
  for (const r of rows) {
    before += r.raw.costUsd ?? 0
    after += r.costUsd ?? 0
  }
  return { rows: rows.length, before, after }
}
