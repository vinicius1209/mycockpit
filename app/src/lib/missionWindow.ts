// A JANELA VIVA (R9 do docs/mocks/missao-README.md).
//
// A primeira rodada dos mocks assumiu 3 fases porque era o que o print mostrava,
// e 3 é um número gentil. Nada no código garante 3: `addPhase` não tem teto, o
// import validado não tem teto, e o loop de correção apenda até +4 sozinho. Um
// plano de 12 é montável hoje, no editor, sem tocar em código.
//
// Com 12 fases o recolhimento deixa de ser economia de tela e vira ESTRUTURA:
// sem ele a fase viva sai da tela, e o único assunto da tela sai da tela.
//
// A regra, e ela não tem limiar de N (limiar seria um parâmetro a mais pra
// fazer o mesmo trabalho):
//
//   sempre visíveis   a fase VIVA (aberta), a ANTERIOR (uma linha) e a PRÓXIMA
//                     (uma linha)
//   o resto           agrega em DOIS stubs, um de cada lado, e cada stub
//                     DECLARA o que engoliu em vez de esconder
//
// Com 3 ou 4 fases a janela já cobre o plano inteiro e nenhum stub aparece —
// então a regra não fica boba em missão curta.
//
// QUATRO EXCEÇÕES que nunca agregam: fase que falhou ou foi interrompida, fase
// segurada por você, fase com marca de procedência (entrou depois da decolagem)
// e fase que você abriu à mão.
//
// Puro. `now` injetado onde o tempo importa.

import { fmtDuration } from "@/lib/format"
import { costAbility, fmtMissionCost, missionCostCoverage } from "@/lib/missionCost"
import {
  phaseProvenance,
  type MissionPhaseRun,
} from "@/lib/missionTypes"

export interface PhaseRow {
  kind: "fase"
  index: number
  /** A fase viva abre; as vizinhas ficam em uma linha. */
  open: boolean
}

export interface StubRow {
  kind: "stub"
  side: "passado" | "futuro"
  /** Índices engolidos (a UI expande abrindo todos). */
  indexes: number[]
  /** O RECIBO do stub: ele tem que ser informação, não contagem. */
  label: string
  /** O que a agregação não pode esconder, dito na cara. */
  declares: string | null
}

export type WindowRow = PhaseRow | StubRow

/** Uma fase nunca agrega quando ela é excepcional (as quatro do R9). */
export function neverCollapses(
  phase: MissionPhaseRun,
  index: number,
  args: { holdPhase?: number | null; manuallyOpen?: ReadonlySet<number> },
): boolean {
  if (phase.status === "error" || phase.status === "aborted") return true
  if (args.holdPhase === index) return true
  if (phaseProvenance(phase.def) !== null) return true
  return Boolean(args.manuallyOpen?.has(index))
}

function stubRecibo(
  phases: MissionPhaseRun[],
  indexes: number[],
  side: "passado" | "futuro",
): StubRow {
  const n = indexes.length
  if (side === "futuro") {
    const semCusto = indexes.filter(
      (i) => costAbility(phases[i].def.agent) === "nenhuma",
    ).length
    const apendadas = indexes.filter(
      (i) => phaseProvenance(phases[i].def) !== null,
    ).length
    const partes: string[] = []
    if (apendadas > 0) {
      partes.push(
        `${apendadas} ${apendadas === 1 ? "apendada" : "apendadas"} no voo`,
      )
    }
    if (semCusto > 0) {
      partes.push(
        `${semCusto} ${semCusto === 1 ? "não mede custo" : "não medem custo"}`,
      )
    }
    return {
      kind: "stub",
      side,
      indexes,
      label: `+${n} ${n === 1 ? "fase na fila" : "fases na fila"}`,
      declares: partes.length > 0 ? partes.join(" · ") : null,
    }
  }
  // passado: o recibo é duração + custo + o que a agregação engoliu.
  const dur = indexes.reduce((acc, i) => {
    const p = phases[i]
    return p.startedAt != null && p.endedAt != null
      ? acc + Math.max(0, p.endedAt - p.startedAt)
      : acc
  }, 0)
  const custo = indexes.reduce((acc, i) => acc + phases[i].costUsd, 0)
  const cov = missionCostCoverage(indexes.map((i) => phases[i]))
  const acoes = indexes.reduce(
    (acc, i) => acc + (phases[i].items ?? []).filter((x) => x.kind === "tool").length,
    0,
  )
  const partes: string[] = []
  if (dur > 0) partes.push(fmtDuration(dur))
  if (cov.measured > 0) {
    partes.push(fmtMissionCost(custo, cov.estimated ? "estimated" : "reported"))
  }
  if (acoes > 0) partes.push(`${acoes} ${acoes === 1 ? "ação" : "ações"}`)
  return {
    kind: "stub",
    side,
    indexes,
    label: `${n} ${n === 1 ? "fase concluída" : "fases concluídas"}`,
    declares:
      [
        partes.join(" · "),
        cov.unmeasurable > 0
          ? `${cov.unmeasurable} sem custo medido`
          : "",
      ]
        .filter(Boolean)
        .join(" · ") || null,
  }
}

/**
 * A janela viva. `current` é a fase corrente; tudo é derivado dela.
 */
export function missionWindow(
  phases: MissionPhaseRun[],
  current: number,
  args: {
    holdPhase?: number | null
    manuallyOpen?: ReadonlySet<number>
  } = {},
): WindowRow[] {
  const n = phases.length
  const cur = Math.min(Math.max(0, current), Math.max(0, n - 1))
  const rows: WindowRow[] = []
  const visivel = (i: number) =>
    i === cur ||
    i === cur - 1 ||
    i === cur + 1 ||
    neverCollapses(phases[i], i, args)

  let pendentes: number[] = []
  const despeja = (side: "passado" | "futuro") => {
    if (pendentes.length === 0) return
    rows.push(stubRecibo(phases, pendentes, side))
    pendentes = []
  }

  for (let i = 0; i < n; i++) {
    if (visivel(i)) {
      despeja(i < cur ? "passado" : "futuro")
      rows.push({ kind: "fase", index: i, open: i === cur })
    } else {
      pendentes.push(i)
    }
  }
  despeja("futuro")
  return rows
}
