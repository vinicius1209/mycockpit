import { describe, expect, it } from "vitest"
import { gastoDaFaixa } from "./gastoDaFaixa"

const AGORA = new Date(2026, 8, 26, 15, 0).getTime()
const HORA = 3_600_000
const linha = (agent: string, costUsd: number | null, horasAtras: number) => ({
  agent,
  projectId: "p1",
  costUsd,
  tokens: 100,
  createdAt: AGORA - horasAtras * HORA,
})

// ADR-262: "uma forma de ver de todos os providers".
describe("o gasto na faixa", () => {
  const rows = [
    linha("claude-code", 10, 1),
    linha("claude-code", 5, 30), // ontem
    linha("codex", 2, 2),
    linha("opencode", null, 3), // turno sem preço
    linha("codex", 99, 24 * 9), // fora da semana
  ]

  it("hoje soma todos os motores, desde a meia-noite local", () => {
    expect(gastoDaFaixa(rows, AGORA).hoje).toBe(12)
  })

  it("por motor, hoje e 7 dias, do maior para o menor, com o sem-preço à parte", () => {
    const g = gastoDaFaixa(rows, AGORA)
    expect(g.porMotor).toEqual([
      { agent: "claude-code", hoje: 10, semana: 15, semPreco: 0 },
      { agent: "codex", hoje: 2, semana: 2, semPreco: 0 },
      { agent: "opencode", hoje: 0, semana: 0, semPreco: 1 },
    ])
    expect(g.semana).toBe(17)
    expect(g.semPreco).toBe(1)
  })
})
