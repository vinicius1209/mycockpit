// R7 — o preço do gesto, dito ANTES do clique, e lido do registry/estado.
// O ponto do teste: "Pausar" não existe no vocabulário, e o preço de
// interromper NÃO é o mesmo para todo motor.

import { describe, expect, it } from "vitest"
import {
  MISSION_GESTURES,
  interruptPrice,
  stopPrice,
} from "./missionGestures"

describe("vocabulário de intervenção", () => {
  it("não existe 'Pausar' (o rótulo mentiria sobre o processo)", () => {
    const rotulos = Object.values(MISSION_GESTURES).map((g) =>
      g.label.toLowerCase(),
    )
    expect(rotulos.some((r) => r.includes("pausar"))).toBe(false)
  })

  it("só segurar é reversível; interromper e parar não são", () => {
    expect(MISSION_GESTURES.segurar.reversible).toBe(true)
    expect(MISSION_GESTURES.interromper.reversible).toBe(false)
    expect(MISSION_GESTURES.parar.reversible).toBe(false)
  })

  it("interromper diz que o worktree fica, porque ele fica", () => {
    expect(MISSION_GESTURES.interromper.effect).toContain("worktree")
  })
})

describe("preço de interromper (por motor, do registry)", () => {
  it("motor que retoma sessão perde só o resto do turno", () => {
    expect(interruptPrice("claude-code")).toContain("retoma a sessão")
    expect(interruptPrice("codex")).toContain("retoma a sessão")
  })

  it("motor que NÃO retoma perde a fase inteira, e o texto diz isso", () => {
    const p = interruptPrice("agy")
    expect(p).toContain("não retoma sessão")
    expect(p).toContain("fase inteira do zero")
  })

  it("motor fora do registry cai no lado pessimista", () => {
    // prometer retomada que não existe é o erro caro.
    expect(interruptPrice("motor-novo")).toContain("não retoma sessão")
  })
})

describe("preço de parar (lido do ESTADO, porque escala com o plano)", () => {
  it("numa missão de 3 na fase 1, cancela duas", () => {
    expect(stopPrice({ current: 0, total: 3, costLabel: "US$ 2,07" })).toContain(
      "cancela 2 fases",
    )
  })

  it("numa missão de 12 na fase 7, cancela cinco (o preço escala)", () => {
    const p = stopPrice({ current: 6, total: 12, costLabel: "US$ 13,28" })
    expect(p).toContain("cancela 5 fases")
    expect(p).toContain("US$ 13,28")
  })

  it("na última fase não há fila a cancelar, e o texto não inventa uma", () => {
    expect(stopPrice({ current: 2, total: 3, costLabel: "US$ 1,00" })).toContain(
      "não sobra nenhuma fase na fila",
    )
  })
})
