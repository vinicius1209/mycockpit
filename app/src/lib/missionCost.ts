// CUSTO HONESTO da missão (R3 do docs/mocks/missao-README.md). O build 193
// pintava `US$ 0,000` depois de 16 min de Opus: número não medido com cara de
// medido. A causa é simples e a correção também: `costUsd` nasce 0 e só recebe
// valor no `result` de cada fase, então "ainda não sei" e "custou zero" eram o
// mesmo pixel.
//
// Três estados, e nenhum deles é zero:
//   —          ainda não sei (a fase não fechou, ou fechou sem o motor mandar)
//   não mede   o motor não reporta custo NEM tokens, então não existe número
//   US$ X,YZ   medido, com "~" quando a conta é estimada por tokens
//
// A decisão de qual estado vem do REGISTRY (structuredOutput/reportsCost, o
// espelho de adapters.rs), nunca de nome de motor: agent novo cai na régua
// sozinho, e motor desconhecido nunca declara "não mede" (declarar ignorância
// alheia sem base seria o mesmo pecado do zero).
//
// Puro: sem store, sem React, sem Date.now(). Testado em missionCost.test.ts.

import type { CostSource } from "@/lib/agent"
import { agentDef } from "@/lib/agents"
import type { MissionPhaseRun } from "@/lib/missionTypes"

/** O que um motor consegue dizer sobre o próprio custo. */
export type CostAbility =
  /** entrega dólar no fim do turno (CostSource::Reported). */
  | "dolar"
  /** não entrega dólar, mas entrega tokens: a conta é ESTIMADA ("~"). */
  | "estimativa"
  /** não entrega nem dólar nem tokens: não existe custo, nem aproximado. */
  | "nenhuma"
  /** motor fora do registry: não se promete nada, e não se acusa nada. */
  | "desconhecida"

/** Capacidade de medir custo DESTE motor, lida do registry. */
export function costAbility(agentId: string): CostAbility {
  const def = agentDef(agentId)
  if (!def) return "desconhecida"
  if (def.reportsCost) return "dolar"
  // sem dólar, o que resta é a conta por tokens — e tokens só chegam de um
  // stream estruturado. Sem os dois, não há de onde tirar número nenhum.
  return def.structuredOutput ? "estimativa" : "nenhuma"
}

/** Formato do custo NA MISSÃO: 2 casas sempre. Diferente do `fmtCost` do fio
 *  (3 casas abaixo de US$ 1) de propósito: lá o número é o de UM turno, onde o
 *  sub-centavo é a informação; aqui é o de uma fase inteira ou da missão, e a
 *  terceira casa só serve pra produzir `US$ 0,000`, que é o bug que este
 *  módulo existe pra matar. Vírgula decimal (pt-BR), "~" quando estimado. */
export function fmtMissionCost(usd: number, source?: CostSource): string {
  const num = usd.toFixed(2).replace(".", ",")
  return `${source === "estimated" || source === "unknown" ? "~" : ""}US$ ${num}`
}

export type MissionCostState =
  | {
      kind: "pendente"
      /** O que o slot do valor mostra. Sempre o glifo de ausência. */
      value: "—"
      /** Quando o número aterrissa, dito na legenda (nunca dentro do valor:
       *  frase no lugar do número quebra o `tabular-nums` da coluna). */
      hint: string
    }
  | {
      kind: "nao-mede"
      value: "não mede"
      /** O MOTIVO, com o motor nomeado. */
      hint: string
    }
  | {
      kind: "medido"
      value: string
      estimated: boolean
      hint: string | null
    }

/** Nome curto do motor pra legenda ("o agy não reporta custo"). Motor fora do
 *  registry aparece com o id cru: id feio é identidade. */
function engineName(agentId: string): string {
  return agentDef(agentId)?.shortLabel ?? agentId
}

/** Estado do custo de UMA fase. `phase.costSource` é o que separa "custou 0"
 *  de "ninguém mediu": sem procedência, um `costUsd` zerado NUNCA vira número. */
export function phaseCostState(phase: MissionPhaseRun): MissionCostState {
  const ability = costAbility(phase.def.agent)
  const measured = phase.costSource != null && phase.costUsd > 0
  if (measured) {
    return {
      kind: "medido",
      value: fmtMissionCost(phase.costUsd, phase.costSource),
      estimated: phase.costSource !== "reported",
      hint:
        phase.costSource === "reported"
          ? null
          : `estimado por tokens (o ${engineName(phase.def.agent)} não reporta dólar)`,
    }
  }
  if (ability === "nenhuma") {
    // Vale ANTES de rodar também: a fase na fila já avisa, pra a ausência de
    // número não ser surpresa no fim (a declaração de granularidade do B).
    return {
      kind: "nao-mede",
      value: "não mede",
      hint: `o ${engineName(phase.def.agent)} não reporta custo nem tokens`,
    }
  }
  const closed =
    phase.status === "done" ||
    phase.status === "error" ||
    phase.status === "aborted"
  return {
    kind: "pendente",
    value: "—",
    hint: closed
      ? "a fase fechou sem o motor devolver o custo"
      : "fecha ao fim desta fase",
  }
}

/** Cobertura da soma da missão: de quantas fases FECHADAS o custo veio mesmo.
 *  O total só é honesto se disser isso — somar 5 fases e apresentar como se
 *  fossem 6 é a mesma ficção do zero, só que agregada. */
export interface MissionCostCoverage {
  /** Fases com desfecho terminal (as únicas que podiam ter custo). */
  closed: number
  /** Fases fechadas cujo custo foi de fato medido. */
  measured: number
  /** Fases fechadas de motor que não mede (o buraco tem nome). */
  unmeasurable: number
  /** Alguma parcela veio estimada por tokens ⇒ o total ganha "~". */
  estimated: boolean
}

export function missionCostCoverage(
  phases: MissionPhaseRun[],
): MissionCostCoverage {
  let closed = 0
  let measured = 0
  let unmeasurable = 0
  let estimated = false
  for (const p of phases) {
    if (p.status !== "done" && p.status !== "error" && p.status !== "aborted") {
      continue
    }
    closed++
    if (p.costSource != null && p.costUsd > 0) {
      measured++
      if (p.costSource !== "reported") estimated = true
    } else if (costAbility(p.def.agent) === "nenhuma") {
      unmeasurable++
    }
  }
  return { closed, measured, unmeasurable, estimated }
}

/** O total da missão + a declaração de cobertura ("medido em 1 de 3 fases").
 *  Sem nenhuma fase fechada o total é "—": zero antes do primeiro result é a
 *  cara do bug, não um valor. */
export function missionCostState(
  costTotal: number,
  phases: MissionPhaseRun[],
): MissionCostState {
  const cov = missionCostCoverage(phases)
  if (cov.measured === 0) {
    return {
      kind: "pendente",
      value: "—",
      hint:
        cov.unmeasurable > 0 && cov.unmeasurable === cov.closed
          ? `nenhum motor desta missão reporta custo (${cov.closed} ${cov.closed === 1 ? "fase fechada" : "fases fechadas"})`
          : "fecha ao fim de cada fase",
    }
  }
  return {
    kind: "medido",
    value: fmtMissionCost(costTotal, cov.estimated ? "estimated" : "reported"),
    estimated: cov.estimated,
    hint:
      cov.measured === cov.closed
        ? null
        : `medido em ${cov.measured} de ${cov.closed} ${cov.closed === 1 ? "fase fechada" : "fases fechadas"}`,
  }
}
