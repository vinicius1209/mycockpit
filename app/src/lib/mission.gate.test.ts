// Gate humano da missão: política de quando pausar + bloco de decisões
// injetado na fase seguinte. Lógica pura (o pause/resume vive no store).

import { describe, it, expect } from "vitest"
import {
  buildGateDecisionsBlock,
  gateQuestions,
  normalizeGateAnswers,
  phasePrompt,
  splitGateAttachments,
} from "@/lib/mission"
import type { Attachment, AttachmentKind } from "@/lib/attachments"
import type { GateAnswer } from "@/lib/missionTypes"

function att(name: string, kind: AttachmentKind): Attachment {
  return {
    path: `attachments/c1/${name}`,
    name,
    kind,
    mime: kind === "pdf" ? "application/pdf" : "image/png",
    bytes: 10,
  }
}

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

describe("normalizeGateAnswers (retrocompat string[] → GateAnswer[])", () => {
  it("string[] legado vira GateAnswer[] sem anexos", () => {
    expect(normalizeGateAnswers(["a", ""])).toEqual([
      { text: "a" },
      { text: "" },
    ])
  })

  it("GateAnswer[] rico passa intacto (texto + anexos preservados)", () => {
    const rich: GateAnswer[] = [
      { text: "usa a 5175", attachments: [att("shot.png", "image")] },
    ]
    expect(normalizeGateAnswers(rich)).toEqual(rich)
  })
})

describe("splitGateAttachments (caps do agent da PRÓXIMA fase)", () => {
  it("agrega os anexos de todas as respostas na ordem", () => {
    const answers: GateAnswer[] = [
      { text: "a", attachments: [att("1.png", "image")] },
      { text: "b" },
      { text: "c", attachments: [att("2.png", "image")] },
    ]
    const { kept, dropped } = splitGateAttachments(answers, {
      image: true,
      pdf: true,
    })
    expect(kept.map((k) => k.name)).toEqual(["1.png", "2.png"])
    expect(dropped).toEqual([])
  })

  it("caps parciais (codex: image sim, pdf não) → mantém imagem, descarta PDF", () => {
    const answers: GateAnswer[] = [
      { text: "a", attachments: [att("shot.png", "image"), att("spec.pdf", "pdf")] },
    ]
    const { kept, dropped } = splitGateAttachments(answers, {
      image: true,
      pdf: false,
    })
    expect(kept.map((k) => k.name)).toEqual(["shot.png"])
    expect(dropped.map((d) => d.name)).toEqual(["spec.pdf"])
  })

  it("agent sem suporte nenhum (agy) → descarta tudo, nunca lança", () => {
    const answers: GateAnswer[] = [
      { text: "a", attachments: [att("shot.png", "image"), att("spec.pdf", "pdf")] },
    ]
    const { kept, dropped } = splitGateAttachments(answers, {
      image: false,
      pdf: false,
    })
    expect(kept).toEqual([])
    expect(dropped).toHaveLength(2)
  })

  it("kind 'other' nunca passa (caps só declaram image/pdf)", () => {
    const { kept, dropped } = splitGateAttachments(
      [{ text: "a", attachments: [att("x.bin", "other")] }],
      { image: true, pdf: true },
    )
    expect(kept).toEqual([])
    expect(dropped.map((d) => d.name)).toEqual(["x.bin"])
  })

  it("respostas sem anexos → nada de nada", () => {
    expect(
      splitGateAttachments([{ text: "a" }], { image: true, pdf: true }),
    ).toEqual({ kept: [], dropped: [] })
  })
})
