// Retrospectiva do Painel (ADR-040): a matemática, sem React e sem banco.
//
// Regra que vale pro arquivo inteiro: **só entra número MEDIDO**. Toda conta
// derivada carrega o denominador à vista (a UI imprime a ressalva ao lado),
// porque número derivado sem denominador é o começo de uma métrica que
// ninguém confere. Onde o denominador é zero, a função devolve `null` e a UI
// diz o que falta — nunca 0, nunca "∞", nunca uma média inventada.
//
// O mapa de calor pinta **US$ por hora**, não atividade: heatmap de atividade
// num app de uma pessoa é teatro (não existe streak pra manter nem público pra
// impressionar). Pintando dinheiro ele vira detector de vazamento, e por isso
// segue a régua de MEDIDOR do STYLEGUIDE §2 (`lib/meter.ts`, a mesma do anel
// de contexto e das barras de uso): cinza < 60% do pico, âmbar 60 a 80,
// vermelho ≥ 80.

import type { LedgerRow } from "@/lib/panel"
import { meterTone, type MeterTone } from "@/lib/meter"

const DAY_MS = 24 * 60 * 60 * 1000
export const HOURS_IN_DAY = 24

export interface HeatDay {
  /** "31/07" (dia LOCAL). */
  label: string
  /** meia-noite local do dia, em epoch ms. */
  dayStart: number
  /** gasto do dia inteiro (soma das 24 horas). */
  total: number
  /** 24 posições, 0h a 23h locais. */
  hours: number[]
}

export interface Heatmap {
  /** do mais antigo pro mais novo; a última posição é hoje. */
  days: HeatDay[]
  /** maior valor de UMA hora no período (a régua do medidor). */
  peak: number
  /** soma de tudo que entrou no mapa. */
  total: number
}

function dayLabel(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0")
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  return `${dd}/${mm}`
}

/** Bucketiza o ledger em (dia local × hora local). Uma passada O(n) sobre as
 *  linhas — a UI memoiza por referência de ledger, então isso roda uma vez por
 *  carga, não por render. Linha no futuro ou fora da janela é descartada. */
export function hourlyHeatmap(
  rows: LedgerRow[],
  days: number,
  now = Date.now(),
): Heatmap {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const startToday = midnight.getTime()
  const out: HeatDay[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(startToday)
    d.setDate(d.getDate() - i)
    out.push({
      label: dayLabel(d),
      dayStart: d.getTime(),
      total: 0,
      hours: new Array(HOURS_IN_DAY).fill(0),
    })
  }
  let peak = 0
  let total = 0
  for (const r of rows) {
    if (r.createdAt > now) continue
    const at = new Date(r.createdAt)
    const atMidnight = new Date(r.createdAt)
    atMidnight.setHours(0, 0, 0, 0)
    // round absorve a folga de DST (mesma conta do dailySpend).
    const back = Math.round((startToday - atMidnight.getTime()) / DAY_MS)
    if (back < 0 || back >= days) continue
    const day = out[days - 1 - back]
    const c = r.costUsd ?? 0
    day.hours[at.getHours()] += c
    day.total += c
    total += c
    if (day.hours[at.getHours()] > peak) peak = day.hours[at.getHours()]
  }
  return { days: out, peak, total }
}

/** Tom da célula. `none` = hora sem gasto nenhum (fundo de grade, não é
 *  "saudável", é ausência). O resto delega pra régua única de medidor. */
export type HeatTone = "none" | MeterTone

export function heatTone(value: number, peak: number): HeatTone {
  if (value <= 0) return "none"
  if (peak <= 0) return "none"
  return meterTone((value / peak) * 100)
}

/** Opacidade da rampa CINZA (tom `ok`), em %. Piso alto de propósito: qualquer
 *  gasto tem que ser visível, e o topo da faixa cinza não pode encostar no
 *  âmbar. Fora do tom `ok` a cor é chapada (o medidor já gritou). */
export function heatFillPct(value: number, peak: number): number {
  if (peak <= 0 || value <= 0) return 0
  const ceiling = peak * 0.6
  const k = Math.min(1, value / ceiling)
  return Math.round(22 + k * 56)
}

export interface PeakHour {
  dayLabel: string
  /** 0 a 23, hora LOCAL. */
  hour: number
  costUsd: number
  dayTotal: number
  /** fração 0–1 do dia que essa única hora comeu. */
  shareOfDay: number
}

/** A hora mais cara do período. É o único "insight" da tela, e ele é
 *  literalmente uma célula do mapa (nada é inferido): serve pra explicar o
 *  pico que um sparkline desenha sem explicação. null = ninguém gastou nada. */
export function peakHour(map: Heatmap): PeakHour | null {
  let best: PeakHour | null = null
  for (const day of map.days) {
    for (let h = 0; h < HOURS_IN_DAY; h++) {
      const v = day.hours[h]
      if (v <= 0) continue
      if (best && v <= best.costUsd) continue
      best = {
        dayLabel: day.label,
        hour: h,
        costUsd: v,
        dayTotal: day.total,
        shareOfDay: day.total > 0 ? v / day.total : 0,
      }
    }
  }
  return best
}

/** Gasto médio por dia da janela. É o número de orçamento: o único que não
 *  depende de nada além do ledger. */
export function perDay(total: number, days: number): number | null {
  return days > 0 ? total / days : null
}

/** Custo por entrega REGISTRADA. null com zero entregas: dividir por zero
 *  entregas não é "infinito", é "o app não sabe" (a UI diz isso). */
export function perDelivery(total: number, deliveries: number): number | null {
  return deliveries > 0 ? total / deliveries : null
}

/** Existe, NESTA instalação, algum gesto capaz de registrar uma entrega?
 *
 *  Sobrou UM writer de `deliveries`: missão concluída (`store/mission.ts`), e
 *  `missionEnabled` vem DESLIGADO por padrão. O outro writer era card indo pra
 *  Feito (`store/cards.ts`): o Board saiu do desktop no ADR-040 e do Companion
 *  no ADR-041, então nenhuma superfície fecha card hoje — o Companion ligado
 *  deixou de ser resposta pra esta pergunta. Sem writer, o denominador de
 *  "US$ por entrega" está CONGELADO enquanto o numerador cresce todo dia: o
 *  número vira ficção com cara de instrumento. */
export function hasDeliveryWriter(s: { missionEnabled: boolean }): boolean {
  return s.missionEnabled
}

/** O derivado "por entrega registrada" aparece? Só com um writer ligado (o
 *  denominador ainda pode crescer) ou com entrega REAL na janela (o número
 *  descreve algo que aconteceu). Sem os dois, esconder é a leitura honesta:
 *  §5 camada 2, "não-configurado esconde". */
export function showsPerDelivery(
  hasWriter: boolean,
  deliveriesInWindow: number,
): boolean {
  return hasWriter || deliveriesInWindow > 0
}

/** Uma disputa arquivada, do jeito que ela sobrevive no banco (fusion_runs). */
export interface FusionOutcome {
  createdAt: number
  /** id do candidato escolhido; null = ninguém escolheu (ainda). */
  chosenId: string | null
  candidates: { id: string; agent: string; costUsd: number | null }[]
}

export interface DiscardedSpend {
  costUsd: number
  /** quantas disputas JULGADAS entraram na conta. */
  disputes: number
}

/** O lado DESCARTADO das disputas: os dois lados rodaram, um foi escolhido, e
 *  o custo do outro está no ledger. É o único desperdício que o app consegue
 *  provar (conversa que não virou entrega NÃO é desperdício demonstrável).
 *  Disputa sem vencedor escolhido fica de fora: sem escolha não há descarte. */
export function discardedSpend(runs: FusionOutcome[]): DiscardedSpend {
  let costUsd = 0
  let disputes = 0
  for (const r of runs) {
    if (!r.chosenId) continue
    if (!r.candidates.some((c) => c.id === r.chosenId)) continue
    disputes += 1
    for (const c of r.candidates) {
      if (c.id === r.chosenId) continue
      costUsd += c.costUsd ?? 0
    }
  }
  return { costUsd, disputes }
}

export interface AgentCross {
  agent: string
  costUsd: number
  /** fração 0–1 do custo total da janela. */
  share: number
  /** entregas REGISTRADAS por este agent na mesma janela. */
  deliveries: number
  /** custo ÷ entregas do próprio agent; null sem entrega registrada. */
  perDelivery: number | null
}

/** ADR-047 — turnos SEM preço por agent (o `costUsd` do cruzamento acima é só
 *  o resto). Existe separado porque a linha do agent precisa dizer isso: o
 *  motor que o app não sabe cobrar apareceria como o mais barato de todos. */
export function unpricedByAgent(rows: LedgerRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) {
    if (r.costUsd == null) out.set(r.agent, (out.get(r.agent) ?? 0) + 1)
  }
  return out
}

/** Custo por agente CRUZADO com as entregas do mesmo agente. Sozinho, "o Codex
 *  gastou mais" não decide nada (pode ser volume, não ineficiência); ao lado
 *  das entregas dele, vira pergunta respondível. Agent que só aparece nas
 *  entregas (custo fora da janela) não inventa linha: a base é o ledger. */
export function agentCross(
  rows: LedgerRow[],
  deliveries: { agent: string; createdAt: number }[],
): AgentCross[] {
  const cost = new Map<string, number>()
  let total = 0
  for (const r of rows) {
    const c = r.costUsd ?? 0
    total += c
    cost.set(r.agent, (cost.get(r.agent) ?? 0) + c)
  }
  const count = new Map<string, number>()
  for (const d of deliveries) {
    count.set(d.agent, (count.get(d.agent) ?? 0) + 1)
  }
  return [...cost.entries()]
    .map(([agent, costUsd]) => {
      const n = count.get(agent) ?? 0
      return {
        agent,
        costUsd,
        share: total > 0 ? costUsd / total : 0,
        deliveries: n,
        perDelivery: n > 0 ? costUsd / n : null,
      }
    })
    .sort((a, b) => b.costUsd - a.costUsd)
}

/** Fatia do gasto que está ATRIBUÍDA a uma entrega registrada. Não julga o
 *  trabalho: julga o DENOMINADOR (conversa que virou código sem virar entrega
 *  não entra). null quando não houve gasto nenhum na janela. */
export function attributedShare(
  total: number,
  deliveries: { costUsd: number | null }[],
): { costUsd: number; share: number } | null {
  if (total <= 0) return null
  let costUsd = 0
  for (const d of deliveries) costUsd += d.costUsd ?? 0
  return { costUsd, share: costUsd / total }
}
