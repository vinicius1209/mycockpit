// Gate humano da missão: política de quando pausar + bloco de decisões
// injetado na fase seguinte. Lógica pura (o pause/resume vive no store).

import { describe, it, expect } from "vitest"
import {
  buildGateDecisionsBlock,
  gateQuestions,
  phasePrompt,
} from "@/lib/mission"

describe("gateQuestions (quando a missão pausa)", () => {
  it("pausa quando há perguntas E existe próxima fase", () => {
    expect(gateQuestions(["Posso abrir o socket?"], true)).toEqual([
      "Posso abrir o socket?",
    ])
  })

  it("NÃO pausa na última fase (as perguntas vão pro resumo, não pro gate)", () => {
    expect(gateQuestions(["Pergunta?"], false)).toEqual([])
  })

  it("sem perguntas / vazias / whitespace → sem gate", () => {
    expect(gateQuestions(undefined, true)).toEqual([])
    expect(gateQuestions([], true)).toEqual([])
    expect(gateQuestions(["  ", ""], true)).toEqual([])
  })

  it("limpa whitespace e descarta itens vazios, preservando a ordem", () => {
    expect(gateQuestions(["  a?  ", "", "b?"], true)).toEqual(["a?", "b?"])
  })
})

describe("buildGateDecisionsBlock (respostas → prompt da próxima fase)", () => {
  it("pareia pergunta e resposta na ordem", () => {
    const block = buildGateDecisionsBlock(
      ["Socket 5175?", "Fixtures ou live?"],
      ["Sim, pode", "Fixtures primeiro"],
    )
    expect(block).toContain("1. P: Socket 5175?")
    expect(block).toContain("R: Sim, pode")
    expect(block).toContain("2. P: Fixtures ou live?")
    expect(block).toContain("R: Fixtures primeiro")
  })

  it("resposta em branco vira delegação explícita ao agente", () => {
    const block = buildGateDecisionsBlock(["Qual porta?"], ["   "])
    expect(block).toContain("(sem resposta — decida você, com bom senso)")
  })

  it("entra no phasePrompt como diretriz (antes do handoff)", () => {
    const decisions = buildGateDecisionsBlock(["Q?"], ["R!"])
    const prompt = phasePrompt({
      persona: "executor",
      task: "tarefa",
      handoffPath: ".mission/1-executor.json",
      priorHandoffs: "## fase anterior",
      userDecisions: decisions,
    })
    const iDecisions = prompt.indexOf("Decisões do usuário (gate humano)")
    const iHandoff = prompt.indexOf("Handoff das fases anteriores")
    expect(iDecisions).toBeGreaterThan(-1)
    expect(prompt).toContain("R: R!")
    expect(iDecisions).toBeLessThan(iHandoff)
  })
})
