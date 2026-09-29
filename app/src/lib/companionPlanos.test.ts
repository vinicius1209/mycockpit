import { describe, expect, it } from "vitest"
import { planosDoCompanion } from "./companionPlanos"
import type { UsageSnapshot } from "./usageWindow"

// 29/09/2026 15:50 no fuso local; o reset de 18:00 do mesmo dia.
const NOW = new Date(2026, 8, 29, 15, 50).getTime()
const as18 = new Date(2026, 8, 29, 18, 0).getTime() / 1000
const dia2 = new Date(2026, 9, 2, 9, 0).getTime() / 1000

const snap = (agent: string, janelas: [string, number, number, number | null][]): UsageSnapshot => ({
  agent,
  source: "oauth",
  planType: "max_20x",
  fetchedAt: NOW - 60_000,
  windows: janelas.map(([id, pct, min, reset]) => ({ id, label: id, usedPercent: pct, resetsAt: reset, windowMinutes: min })),
})

describe("a cota no Companion (F1)", () => {
  it("a pior janela de cada motor, com o texto pronto e o tom da régua", () => {
    const planos = planosDoCompanion(
      {
        "claude-code": snap("claude-code", [["5h", 72.4, 300, as18], ["7d", 41, 10_080, dia2]]),
        codex: snap("codex", [["7d", 31, 10_080, dia2]]),
      },
      {},
      NOW,
    )
    expect(planos).toEqual([
      { agent: "claude-code", rotulo: "Claude Code", janela: "5h", pct: 72, tom: "warn", detalhe: "72% · volta às 18:00" },
      { agent: "codex", rotulo: "Codex", janela: "7d", pct: 31, tom: "ok", detalhe: "31% · volta dia 2, 09:00" },
    ])
  })

  it("leitura velha não aparece; reset que já passou não vira 'volta'", () => {
    const velho = { ...snap("codex", [["7d", 31, 10_080, dia2]]), fetchedAt: NOW - 3 * 3_600_000 }
    expect(planosDoCompanion({ codex: velho }, {}, NOW)).toEqual([])
    const passou = planosDoCompanion({ codex: snap("codex", [["5h", 100, 300, as18 - 4 * 3600]]) }, {}, NOW)
    expect(passou[0].detalhe).toBe("100%")
    expect(passou[0].tom).toBe("danger")
  })
})
