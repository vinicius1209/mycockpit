import { describe, expect, it } from "vitest"
import type { SemanticEvidenceItem, WireConversationMapV1 } from "./types"
import { validateConversationMap } from "./validate"

const evidence: SemanticEvidenceItem[] = [
  {
    itemId: "u1",
    role: "user",
    channel: "executor",
    kind: "user",
    text: "Quero corrigir a rolagem automática.",
  },
  {
    itemId: "a1",
    role: "assistant",
    channel: "executor",
    kind: "text",
    text: "Os testes passaram.",
  },
]

function validWire(): WireConversationMapV1 {
  return {
    currentFocus: {
      text: "Corrigir a rolagem automática",
      certainty: "explicit",
      evidenceItemIds: ["u1"],
    },
    explicitGoalCandidate: null,
    directionChanges: [],
    understandings: [],
    constraints: [],
    openThreads: [],
    latestOutcomeSummary: {
      text: "Os testes da rolagem passaram",
      certainty: "inferred",
      evidenceItemIds: ["a1"],
    },
  }
}

describe("validação do mapa semântico", () => {
  it("normaliza um snapshot válido com ids estáveis", async () => {
    const first = await validateConversationMap(validWire(), evidence)
    const second = await validateConversationMap(validWire(), evidence)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(first.value.currentFocus?.id).toBe(second.value.currentFocus?.id)
      expect(first.value.currentFocus?.evidence[0]).toMatchObject({
        itemId: "u1",
        role: "user",
      })
    }
  })

  it("rejeita a geração inteira quando uma fonte não existe", async () => {
    const wire = validWire()
    wire.currentFocus!.evidenceItemIds = ["fantasma"]
    expect(await validateConversationMap(wire, evidence)).toMatchObject({ ok: false })
  })

  it("não promove objetivo inferido", async () => {
    const wire = validWire()
    wire.explicitGoalCandidate = {
      text: "Entregar a correção",
      certainty: "inferred",
      evidenceItemIds: ["u1"],
    }
    const result = await validateConversationMap(wire, evidence)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.explicitGoal).toBeNull()
  })

  it("rejeita objetivo candidato estruturalmente inválido", async () => {
    const wire = validWire()
    wire.explicitGoalCandidate = {
      text: "Entregar a correção",
      certainty: "explicit",
      evidenceItemIds: ["fantasma"],
    }
    expect(await validateConversationMap(wire, evidence)).toMatchObject({ ok: false })
  })

  it("rejeita certainty explícita sustentada apenas pelo agente", async () => {
    const wire = validWire()
    wire.currentFocus = {
      text: "Publicar uma release",
      certainty: "explicit",
      evidenceItemIds: ["a1"],
    }
    expect(await validateConversationMap(wire, evidence)).toMatchObject({ ok: false })
  })

  it("rejeita campos desconhecidos", async () => {
    expect(
      await validateConversationMap({ ...validWire(), score: 0.98 }, evidence),
    ).toMatchObject({ ok: false, error: "resposta contém campos desconhecidos" })
  })

  it("rejeita mudança de rumo sustentada por saída do executor", async () => {
    const wire = validWire()
    wire.directionChanges = [
      {
        from: "Corrigir a rolagem",
        to: "Publicar a correção",
        evidenceItemIds: ["u1", "a1"],
      },
    ]
    expect(await validateConversationMap(wire, evidence)).toMatchObject({
      ok: false,
    })
  })

  it("rejeita trajetória inventada a partir de uma única fala", async () => {
    const wire = validWire()
    wire.directionChanges = [
      {
        from: "Corrigir a rolagem",
        to: "Publicar a correção",
        evidenceItemIds: ["u1"],
      },
    ]
    expect(await validateConversationMap(wire, evidence)).toMatchObject({
      ok: false,
    })
  })

  it("trata listas opcionais ausentes como vazias", async () => {
    const wire = validWire()
    delete (wire as Partial<WireConversationMapV1>).directionChanges
    delete (wire as Partial<WireConversationMapV1>).understandings
    delete (wire as Partial<WireConversationMapV1>).constraints
    delete (wire as Partial<WireConversationMapV1>).openThreads

    const result = await validateConversationMap(wire, evidence)
    expect(result).toMatchObject({
      ok: true,
      value: {
        directionChanges: [],
        understandings: [],
        constraints: [],
        openThreads: [],
      },
    })
  })
})
