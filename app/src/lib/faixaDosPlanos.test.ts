import { describe, expect, it } from "vitest"
import { planosDaFaixa, rotuloCurtoDaJanela, rotuloDoPlano } from "./faixaDosPlanos"
import type { UsageSnapshot } from "./usageWindow"

const NOW = 1_790_000_000_000
const snap = (agent: string, janelas: [string, number, number | null][]): UsageSnapshot => ({
  agent,
  source: "oauth",
  planType: null,
  fetchedAt: NOW - 60_000,
  windows: janelas.map(([id, pct, min]) => ({ id, label: id, usedPercent: pct, resetsAt: null, windowMinutes: min })),
})

describe("os planos na faixa (ADR-262)", () => {
  const snaps = {
    codex: snap("codex", [["7d", 12, 10_080]]),
    "claude-code": snap("claude-code", [["5h", 73, 300], ["7d", 48, 10_080]]),
  }

  it("cada motor com a SUA pior janela, e o da conversa aberta primeiro", () => {
    const out = planosDaFaixa("codex", snaps, {}, NOW)
    expect(out.map((p) => [p.agent, p.janela.id])).toEqual([["codex", "7d"], ["claude-code", "5h"]])
  })

  it("nenhum motor empresta número: sem leitura fresca, ele não aparece", () => {
    const velho = { ...snaps, codex: { ...snaps.codex, fetchedAt: NOW - 24 * 3_600_000 } }
    expect(planosDaFaixa("codex", velho, {}, NOW).map((p) => p.agent)).toEqual(["claude-code"])
  })

  it("a janela diz o próprio nome", () => {
    expect(rotuloCurtoDaJanela({ id: "5h", label: "5 h", usedPercent: 1, resetsAt: null, windowMinutes: 300 })).toBe("5h")
    expect(rotuloCurtoDaJanela({ id: "7d:fable", label: "", usedPercent: 1, resetsAt: null, windowMinutes: 10_080 })).toBe("7d")
    expect(rotuloCurtoDaJanela({ id: "sessao:x", label: "", usedPercent: 1, resetsAt: null, windowMinutes: null })).toBe("sessao")
  })

  // 26/09/2026: a credencial dizia "pro" numa conta Max 5x.
  it("o plano como a pessoa o conhece", () => {
    expect(rotuloDoPlano("max_5x")).toBe("Max 5x")
    expect(rotuloDoPlano("max_20x")).toBe("Max 20x")
    expect(rotuloDoPlano("plus")).toBe("Plus")
    expect(rotuloDoPlano("ultra")).toBe("Ultra")
    expect(rotuloDoPlano(null)).toBeNull()
  })
})
