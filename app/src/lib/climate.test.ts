import { describe, expect, it } from "vitest"
import { CLIMATE_FRAME_CLASS, riskClimateOn } from "./climate"

const base = {
  hasConversation: true,
  mode: "liberado" as const,
  awaitingDecision: false,
}

describe("riskClimateOn", () => {
  it("acende em Liberado, o único modo que executa sem pedir", () => {
    expect(riskClimateOn(base)).toBe(true)
  })

  it("não existe fora do modo perigoso (nada de clima de Só lê ou Pede)", () => {
    expect(riskClimateOn({ ...base, mode: "padrao" })).toBe(false)
    expect(riskClimateOn({ ...base, mode: "leitura" })).toBe(false)
  })

  it("sem conversa ativa não há próximo turno pra avisar", () => {
    expect(riskClimateOn({ ...base, hasConversation: false })).toBe(false)
  })

  it("decisão pendente ganha do clima (o âmbar acionável não pode ser diluído)", () => {
    expect(riskClimateOn({ ...base, awaitingDecision: true })).toBe(false)
  })

  it("decisão pendente fora do Liberado segue sem clima (não inverte a regra)", () => {
    expect(
      riskClimateOn({ ...base, mode: "padrao", awaitingDecision: true }),
    ).toBe(false)
  })
})

describe("CLIMATE_FRAME_CLASS", () => {
  it("é moldura interna de 1px em âmbar, no token, sem hex cru", () => {
    expect(CLIMATE_FRAME_CLASS).toContain("ring-1")
    expect(CLIMATE_FRAME_CLASS).toContain("ring-inset")
    expect(CLIMATE_FRAME_CLASS).toContain("st-warning")
    expect(CLIMATE_FRAME_CLASS).not.toMatch(/#[0-9a-f]{3,8}/i)
  })

  it("não anima nada (prefers-reduced-motion não tem o que desligar)", () => {
    expect(CLIMATE_FRAME_CLASS).not.toContain("animate")
    expect(CLIMATE_FRAME_CLASS).not.toContain("pulse")
    expect(CLIMATE_FRAME_CLASS).not.toContain("transition")
  })

  it("não rouba clique nem empurra layout", () => {
    expect(CLIMATE_FRAME_CLASS).toContain("pointer-events-none")
    expect(CLIMATE_FRAME_CLASS).toContain("absolute")
  })

  it("não usa vermelho nem verde (falha e marco têm dono próprio)", () => {
    expect(CLIMATE_FRAME_CLASS).not.toContain("st-error")
    expect(CLIMATE_FRAME_CLASS).not.toContain("st-success")
  })
})
