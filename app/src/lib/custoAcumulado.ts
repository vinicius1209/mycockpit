// Correção do histórico de custo gravado como ACUMULADO da sessão (ADR-226).
//
// Desde o claude 2.1.280 (22/09/2026), o `total_cost_usd` de um turno retomado
// é o acumulado da sessão, e a Frota gravou esse número como custo do turno:
// na conversa de 22 e 23/09 a soma dava ~US$ 237 para um gasto real de
// US$ 34,72. O runner já grava o custo do turno; aqui mora a correção do que
// ficou para trás.
//
// Mesma régua da manutenção do ADR-033: gesto EXPLÍCITO em Configurações,
// nunca automático; o valor cru vai para `turn_costs_usage_raw` antes de
// reescrever, e estar nesse backup é o que impede corrigir duas vezes. O
// cálculo é a MESMA regra do runner (`pricing::planejar_custo_do_turno`), sem
// cópia no front. O recibo de cada turno no fio também é corrigido, pela store,
// para a conversa aberta não regravar o valor antigo.

import { invoke } from "@tauri-apps/api/core"
import { reportedCostAgents } from "@/lib/agentRoster"
import { ensureUsageTables, getDb } from "@/lib/db"
import { useChat } from "@/store/chat"

interface LinhaDoLedger {
  run_id: string
  agent: string
  created_at: number
  conv_id: string
  project_id: string
  model: string | null
  cost_usd: number
  input_tokens: number
  output_tokens: number
  cache_tokens: number
  cru_guardado: number | null
}

export interface MudancaDeCusto {
  runId: string
  convId: string
  projectId: string
  cru: number
  corrigido: number
  input: number
  output: number
  cache: number
}

export interface PlanoDeCusto {
  mudancas: MudancaDeCusto[]
  antes: number
  depois: number
}

/** Só leitura: o que a correção mudaria. É o que a tela mostra antes do gesto. */
export async function planejarCustoAcumulado(): Promise<PlanoDeCusto> {
  const vazio = { mudancas: [], antes: 0, depois: 0 }
  const ids = reportedCostAgents().map((a) => a.id)
  const db = await getDb()
  if (!db || !ids.length) return vazio
  await ensureUsageTables(db)
  const ph = ids.map((_, i) => `$${i + 1}`).join(", ")
  const linhas = await db.select<LinhaDoLedger[]>(
    `SELECT t.run_id, t.agent, t.created_at, t.conv_id, t.project_id, t.model, t.cost_usd, t.input_tokens,
            t.output_tokens, t.cache_tokens, r.cost_usd AS cru_guardado
       FROM turn_costs t LEFT JOIN turn_costs_usage_raw r ON r.run_id = t.run_id
      WHERE t.agent IN (${ph}) AND t.cost_usd IS NOT NULL
      ORDER BY t.conv_id, t.created_at`,
    ids,
  )
  // Janela por motor: só o que o CLI INSTALADO hoje gravou pode ter o custo
  // acumulado. Medido nesta máquina: os 4 turnos de 22/09 antes da instalação
  // do claude 2.1.280 (16:50) não têm o padrão; dos 47 depois, 45 crescem em
  // sequência. Antes da janela, a régua de preço erra para menos (a coluna
  // `cache_tokens` junta cache lido e criado) e corrigiria turno certo.
  const janela = new Map<string, number>()
  for (const id of ids) {
    const desde = await invoke<number | null>("instalacao_do_motor", { agent: id })
    if (desde != null) janela.set(id, desde)
  }
  // A base de cada linha é o CRU da linha anterior da mesma conversa (o que o
  // CLI reportou), mesmo que ela já tenha sido corrigida ou seja de antes da
  // janela.
  const candidatas: { linha: LinhaDoLedger; base: number | null }[] = []
  let conversa: string | null = null
  let anterior: number | null = null
  for (const linha of linhas) {
    if (linha.conv_id !== conversa) {
      conversa = linha.conv_id
      anterior = null
    }
    const cru = linha.cru_guardado ?? linha.cost_usd
    const desde = janela.get(linha.agent)
    if (linha.cru_guardado == null && desde != null && linha.created_at >= desde) {
      candidatas.push({ linha, base: anterior })
    }
    anterior = cru
  }
  if (!candidatas.length) return vazio
  const corrigidos = await invoke<number[]>("planejar_custo_do_turno", {
    linhas: candidatas.map(({ linha, base }) => ({
      model: linha.model,
      reportado: linha.cost_usd,
      base,
      input: linha.input_tokens,
      output: linha.output_tokens,
      cache: linha.cache_tokens,
    })),
  })
  const mudancas = candidatas
    .map(({ linha }, i): MudancaDeCusto => ({
      runId: linha.run_id,
      convId: linha.conv_id,
      projectId: linha.project_id,
      cru: linha.cost_usd,
      corrigido: corrigidos[i],
      input: linha.input_tokens,
      output: linha.output_tokens,
      cache: linha.cache_tokens,
    }))
    .filter((m) => Math.abs(m.cru - m.corrigido) > 1e-9)
  return {
    mudancas,
    antes: mudancas.reduce((s, m) => s + m.cru, 0),
    depois: mudancas.reduce((s, m) => s + m.corrigido, 0),
  }
}

/** Troca o custo dos recibos do fio que carregam o cru, na ordem em que
 *  aparecem (o recibo e a linha do ledger nascem do mesmo `result`). PURO. */
export function corrigirRecibos<T extends { kind: string; costUsd?: number }>(
  items: readonly T[],
  trocas: readonly { cru: number; corrigido: number }[],
): { items: T[]; trocados: number } {
  const fila = [...trocas]
  let trocados = 0
  const novos = items.map((item) => {
    if (item.kind !== "result" || item.costUsd == null) return item
    const i = fila.findIndex((t) => Math.abs(t.cru - item.costUsd!) < 1e-9)
    if (i < 0) return item
    const [troca] = fila.splice(i, 1)
    trocados += 1
    return { ...item, costUsd: troca.corrigido }
  })
  return { items: novos, trocados }
}

/** O gesto: guarda o cru, reescreve o ledger e corrige os recibos do fio. */
export async function corrigirCustoAcumulado(): Promise<PlanoDeCusto & { recibos: number }> {
  const plano = await planejarCustoAcumulado()
  const db = await getDb()
  if (!db || !plano.mudancas.length) return { ...plano, recibos: 0 }
  for (const m of plano.mudancas) {
    await db.execute(
      `INSERT OR IGNORE INTO turn_costs_usage_raw
         (run_id, cost_usd, input_tokens, output_tokens, cache_tokens, backed_up_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [m.runId, m.cru, m.input, m.output, m.cache, Date.now()],
    )
    await db.execute("UPDATE turn_costs SET cost_usd = $1 WHERE run_id = $2", [m.corrigido, m.runId])
  }
  let recibos = 0
  const porConversa = new Map<string, MudancaDeCusto[]>()
  for (const m of plano.mudancas) {
    porConversa.set(m.convId, [...(porConversa.get(m.convId) ?? []), m])
  }
  for (const [convId, trocas] of porConversa) {
    const chat = useChat.getState()
    await chat.ensureConversationLoaded(trocas[0].projectId, convId)
    const atual = useChat.getState().byId[convId]
    if (!atual) continue
    const { items, trocados } = corrigirRecibos(atual.items, trocas)
    if (!trocados) continue
    useChat.setState((s) => ({ byId: { ...s.byId, [convId]: { ...s.byId[convId], items } } }))
    await useChat.getState().persist(convId)
    recibos += trocados
  }
  return { ...plano, recibos }
}
