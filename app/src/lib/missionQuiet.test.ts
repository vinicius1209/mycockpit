// R5 — motor calado tratado como motor calado. O cenário é o do segundo print
// do build 193: 5min 42s de agy com um "preparando…" inventado no lugar do que
// a tela não sabia.
//
// `now` é sempre injetado (regra da casa) e os motores saem do registry real:
// a decisão é da capability, e um motor de mentira não pegaria o dia em que o
// registry mudar.

import { describe, expect, it } from "vitest"
import {
  SILENCE_ALERT_MS,
  lastEngineLine,
  narratesActions,
  queuedGranularityNote,
  quietPhaseView,
} from "./missionQuiet"
import type { MissionPhaseRun } from "./missionTypes"
import type { ChatItem } from "@/store/chat"

const T0 = 1_700_000_000_000

function fase(agent: string, over: Partial<MissionPhaseRun> = {}): MissionPhaseRun {
  return {
    def: {
      id: "ui",
      label: "Executar UI",
      persona: "executor",
      agent,
      model: null,
      effort: null,
      maxRetries: 1,
    },
    status: "running",
    attempt: 1,
    costUsd: 0,
    startedAt: T0,
    ...over,
  }
}

describe("quem narra ação por ação (capability, nunca nome)", () => {
  it("claude e codex narram; agy não", () => {
    expect(narratesActions("claude-code")).toBe(true)
    expect(narratesActions("codex")).toBe(true)
    expect(narratesActions("agy")).toBe(false)
  })

  it("motor fora do registry não promete narração", () => {
    expect(narratesActions("motor-novo")).toBe(false)
  })
})

describe("declaração da fase NA FILA (a quietude vira contrato)", () => {
  it("motor que não reporta nada avisa antes de rodar", () => {
    expect(queuedGranularityNote("agy")).toBe("não reporta ações nem custo")
  })

  it("motor que narra mas não dá dólar declara só o custo", () => {
    expect(queuedGranularityNote("codex")).toBe(
      "não reporta custo (o valor sai estimado)",
    )
  })

  it("motor completo não gasta uma linha declarando o óbvio", () => {
    expect(queuedGranularityNote("claude-code")).toBeNull()
  })
})

describe("bloco do motor calado · duas idades", () => {
  it("mostra a idade da fase E a da última saída, separadas", () => {
    const v = quietPhaseView(
      fase("agy", { lastOutputAt: T0 + 5 * 60_000 - 38_000 }),
      T0 + 5 * 60_000,
    )
    expect(v.ages).toBe("rodando há 5min 00s · última saída há 38s")
  })

  it("antes do limiar é cinza: calado não é quebrado", () => {
    const v = quietPhaseView(
      fase("agy", { lastOutputAt: T0 + 60_000 }),
      T0 + 60_000 + SILENCE_ALERT_MS - 1000,
    )
    expect(v.stalled).toBe(false)
    expect(v.headline).toBe("o agy não reporta ação por ação")
  })

  it("acima de 10 min SEM BYTE o texto muda e o alarme liga", () => {
    const v = quietPhaseView(
      fase("agy", { lastOutputAt: T0 + 60_000 }),
      T0 + 60_000 + SILENCE_ALERT_MS + 20_000,
    )
    expect(v.stalled).toBe(true)
    expect(v.headline).toBe("sem sinal do agy há 10min 20s")
  })

  it("o limiar é do ÚLTIMO BYTE, não do tempo da fase", () => {
    // fase de 40 min, falando a cada 30s: saudável.
    const v = quietPhaseView(
      fase("agy", { lastOutputAt: T0 + 40 * 60_000 - 30_000 }),
      T0 + 40 * 60_000,
    )
    expect(v.stalled).toBe(false)
  })

  it("sem nenhuma saída ainda, diz isso em vez de fingir uma idade", () => {
    const v = quietPhaseView(fase("agy"), T0 + 12_000)
    expect(v.sinceLastOutputMs).toBeNull()
    expect(v.ages).toBe("rodando há 12s · nenhuma saída ainda")
    expect(v.stalled).toBe(false)
  })

  it("a ausência de ações é dita como fato verificável, sem verbo inventado", () => {
    const v = quietPhaseView(fase("agy"), T0 + 1000)
    expect(v.reported).toBe("nenhuma ação reportada nesta fase")
    for (const proibida of ["preparando", "trabalhando", "redigindo"]) {
      expect(JSON.stringify(v)).not.toContain(proibida)
    }
  })
})

describe("a última linha que o motor escreveu (conteúdo real)", () => {
  const items: ChatItem[] = [
    { kind: "text", id: "1", text: "primeiro parágrafo" },
    { kind: "text", id: "2", text: "linha a\nvou começar pelo hero" },
  ]

  it("é a última linha do último texto, não um resumo inventado", () => {
    expect(lastEngineLine(items)).toBe("vou começar pelo hero")
  })

  it("sem texto nenhum, é null (o slot fica vazio)", () => {
    expect(lastEngineLine([])).toBeNull()
    expect(lastEngineLine(undefined)).toBeNull()
  })
})
