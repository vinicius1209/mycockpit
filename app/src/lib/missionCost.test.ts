// R3 do docs/mocks/missao-README.md: o custo tem TRÊS estados e nenhum é zero.
// O caso que motivou tudo: `US$ 0,000` depois de 16 min de Opus (build 193).
//
// Os motores citados aqui saem do registry real de propósito — a régua é a
// capability, e um teste com motor de mentira não pegaria o dia em que o
// registry mudar.

import { describe, expect, it } from "vitest"
import {
  costAbility,
  fmtMissionCost,
  missionCostCoverage,
  missionCostState,
  phaseCostState,
} from "./missionCost"
import type { MissionPhaseRun, MissionPhaseStatus } from "./missionTypes"

function fase(
  agent: string,
  status: MissionPhaseStatus,
  costUsd = 0,
  costSource?: MissionPhaseRun["costSource"],
): MissionPhaseRun {
  return {
    def: {
      id: `${agent}-${status}`,
      label: "Fase",
      persona: "executor",
      agent,
      model: null,
      effort: null,
      maxRetries: 1,
    },
    status,
    attempt: 1,
    costUsd,
    costSource,
    startedAt: null,
  }
}

describe("capacidade de medir custo (lida do registry, nunca do nome)", () => {
  it("claude entrega dólar", () => {
    expect(costAbility("claude-code")).toBe("dolar")
  })

  it("codex não entrega dólar mas entrega tokens: a conta é estimada", () => {
    expect(costAbility("codex")).toBe("estimativa")
  })

  // O agy ERA o exemplo de "não existe número": até a 1.1.9 não havia usage
  // nenhum. Desde a 1.1.13 ele entrega tokens (sem dólar), então caiu no mesmo
  // balde do codex — medido 14/08/2026. Quem sustenta o ramo "nenhuma" é o
  // motor ainda não integrado, que é o que o registry declara dele.
  it("agy passou a entregar tokens: a conta dele também é estimada", () => {
    expect(costAbility("agy")).toBe("estimativa")
  })

  it("motor sem stream e sem dólar: não existe número", () => {
    expect(costAbility("opencode")).toBe("nenhuma")
  })

  it("motor fora do registry não é acusado de não medir", () => {
    // "desconhecida" ≠ "nenhuma": declarar ignorância alheia sem base é o
    // mesmo pecado do zero, invertido.
    expect(costAbility("motor-que-nao-existe")).toBe("desconhecida")
  })
})

describe("formato do custo na missão", () => {
  it("usa 2 casas, e é isso que mata o US$ 0,000", () => {
    expect(fmtMissionCost(2.071)).toBe("US$ 2,07")
    expect(fmtMissionCost(13.28)).toBe("US$ 13,28")
  })

  it("marca com ~ o que veio estimado", () => {
    expect(fmtMissionCost(1.5, "estimated")).toBe("~US$ 1,50")
    expect(fmtMissionCost(1.5, "reported")).toBe("US$ 1,50")
  })

  it("número sem procedência conhecida também ganha o ~", () => {
    expect(fmtMissionCost(1.5, "unknown")).toBe("~US$ 1,50")
  })
})

describe("estado do custo de uma fase", () => {
  it("fase rodando num motor que mede mostra — e diz quando fecha", () => {
    const st = phaseCostState(fase("claude-code", "running"))
    expect(st.kind).toBe("pendente")
    expect(st.value).toBe("—")
    expect(st.hint).toBe("fecha ao fim desta fase")
  })

  it("fase NA FILA de motor que não mede já avisa antes de rodar", () => {
    const st = phaseCostState(fase("opencode", "queued"))
    expect(st.kind).toBe("nao-mede")
    expect(st.value).toBe("não mede")
    expect(st.hint).toContain("OpenCode")
    expect(st.hint).toContain("não reporta custo")
  })

  it("fase de motor que não mede NUNCA vira zero, mesmo com costUsd 0", () => {
    const st = phaseCostState(fase("opencode", "done", 0))
    expect(st.kind).toBe("nao-mede")
    expect(st.value).not.toContain("0")
  })

  it("fase concluída com dólar medido mostra o número em 2 casas, sem ~", () => {
    const st = phaseCostState(fase("claude-code", "done", 2.0713, "reported"))
    expect(st).toMatchObject({ kind: "medido", value: "US$ 2,07", estimated: false })
    expect(st.hint).toBeNull()
  })

  it("fase concluída no codex mostra o número COM ~ e diz que é estimado", () => {
    const st = phaseCostState(fase("codex", "done", 0.8, "estimated"))
    expect(st).toMatchObject({ kind: "medido", value: "~US$ 0,80", estimated: true })
    expect(st.hint).toContain("estimado por tokens")
  })

  it("fase de motor que mede que fechou sem número mostra — e diz o que houve", () => {
    // é o caso do build 193: custo 0 com cara de medido. Agora ele confessa.
    const st = phaseCostState(fase("claude-code", "done", 0))
    expect(st.kind).toBe("pendente")
    expect(st.value).toBe("—")
    expect(st.hint).toBe("a fase fechou sem o motor devolver o custo")
  })

  it("número sem procedência não conta como medido", () => {
    // costUsd > 0 mas costSource ausente (run-state legado): a UI não promove
    // um número órfão a valor medido.
    const st = phaseCostState(fase("claude-code", "done", 3.2))
    expect(st.kind).toBe("pendente")
  })
})

describe("cobertura do total da missão", () => {
  const missao = [
    fase("claude-code", "done", 2.07, "reported"),
    fase("opencode", "done", 0),
    fase("codex", "queued"),
  ]

  it("conta só as fases FECHADAS, e separa medida de não-medível", () => {
    expect(missionCostCoverage(missao)).toEqual({
      closed: 2,
      measured: 1,
      unmeasurable: 1,
      estimated: false,
    })
  })

  it("o total declara a cobertura em vez de fingir que somou tudo", () => {
    const st = missionCostState(2.07, missao)
    expect(st).toMatchObject({ kind: "medido", value: "US$ 2,07" })
    expect(st.hint).toBe("medido em 1 de 2 fases fechadas")
  })

  it("cobertura completa não gasta uma linha declarando o óbvio", () => {
    const st = missionCostState(2.07, [fase("claude-code", "done", 2.07, "reported")])
    expect(st.hint).toBeNull()
  })

  it("missão sem nenhuma fase fechada mostra — e não US$ 0,00", () => {
    const st = missionCostState(0, [fase("claude-code", "running")])
    expect(st.value).toBe("—")
    expect(st.hint).toBe("fecha ao fim de cada fase")
  })

  it("missão inteira em motor que não mede diz isso, não mostra zero", () => {
    const st = missionCostState(0, [
      fase("opencode", "done", 0),
      fase("opencode", "done", 0),
    ])
    expect(st.kind).toBe("pendente")
    expect(st.value).toBe("—")
    expect(st.hint).toContain("nenhum motor desta missão reporta custo")
  })

  it("qualquer parcela estimada contamina o total com o ~", () => {
    const st = missionCostState(3.0, [
      fase("claude-code", "done", 2.0, "reported"),
      fase("codex", "done", 1.0, "estimated"),
    ])
    expect(st.value).toBe("~US$ 3,00")
  })
})
