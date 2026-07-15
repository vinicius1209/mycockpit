import { describe, expect, it } from "vitest"
import type { MissionPhaseDef } from "@/lib/missionTypes"
import type { Attachment } from "@/lib/attachments"
import {
  attachmentsSupported,
  clonePhases,
  draftDirty,
  editPhase,
  parseCapInput,
  phasesCustomized,
} from "./missionDraft"

function phase(over: Partial<MissionPhaseDef> = {}): MissionPhaseDef {
  return {
    id: "plan",
    label: "Planejar",
    persona: "planner",
    agent: "claude-code",
    model: "opus",
    effort: null,
    maxRetries: 1,
    ...over,
  }
}

function att(kind: Attachment["kind"]): Attachment {
  return { path: `attachments/c/x.${kind}`, name: "x", kind, mime: "", bytes: 1 }
}

describe("clonePhases", () => {
  it("clona sem compartilhar referência (editar o clone não muta o preset)", () => {
    const base = [phase()]
    const clone = clonePhases(base)
    expect(clone).toEqual(base)
    expect(clone[0]).not.toBe(base[0])
  })
})

describe("editPhase", () => {
  it("trocar o modelo mantém o agent e não muta o array original", () => {
    const base = [phase(), phase({ id: "build", persona: "executor" })]
    const next = editPhase(base, 0, { model: "sonnet" })
    expect(next[0].model).toBe("sonnet")
    expect(next[0].agent).toBe("claude-code")
    expect(next[1]).toBe(base[1]) // fase não editada preservada por referência
    expect(base[0].model).toBe("opus") // original intacto
  })

  it("trocar o agent zera modelo e effort (regra do MissionSettings)", () => {
    const base = [phase({ model: "opus", effort: "high" })]
    const next = editPhase(base, 0, { agent: "codex" })
    expect(next[0]).toMatchObject({ agent: "codex", model: null, effort: null })
  })

  it("re-selecionar o MESMO agent não zera o modelo", () => {
    const base = [phase({ model: "opus" })]
    const next = editPhase(base, 0, { agent: "claude-code" })
    expect(next[0].model).toBe("opus")
  })
})

describe("phasesCustomized (preset → Personalizado ao editar fase)", () => {
  const base = [phase(), phase({ id: "build", persona: "executor", agent: "codex", model: null })]

  it("clone intocado NÃO é personalizado", () => {
    expect(phasesCustomized(base, clonePhases(base))).toBe(false)
  })

  it("editar o modelo de uma fase marca como personalizado", () => {
    expect(phasesCustomized(base, editPhase(clonePhases(base), 0, { model: "sonnet" }))).toBe(true)
  })

  it("editar o agent de uma fase marca como personalizado", () => {
    expect(phasesCustomized(base, editPhase(clonePhases(base), 1, { agent: "agy" }))).toBe(true)
  })

  it("voltar a edição ao valor do preset deixa de ser personalizado", () => {
    let draft = editPhase(clonePhases(base), 0, { model: "sonnet" })
    draft = editPhase(draft, 0, { model: "opus" })
    expect(phasesCustomized(base, draft)).toBe(false)
  })

  it("tamanhos diferentes contam como personalizado", () => {
    expect(phasesCustomized(base, [base[0]])).toBe(true)
  })
})

describe("attachmentsSupported (trava de capacidade da fase 1)", () => {
  it("lista vazia sempre passa", () => {
    expect(attachmentsSupported([], { image: false, pdf: false })).toBe(true)
  })
  it("imagem exige caps.image; pdf exige caps.pdf", () => {
    expect(attachmentsSupported([att("image")], { image: true, pdf: false })).toBe(true)
    expect(attachmentsSupported([att("pdf")], { image: true, pdf: false })).toBe(false)
  })
  it('"other" nunca é suportado', () => {
    expect(attachmentsSupported([att("other")], { image: true, pdf: true })).toBe(false)
  })
})

describe("parseCapInput (teto de custo editável no launcher)", () => {
  it("número válido vira teto ('25' → 25)", () => {
    expect(parseCapInput("25")).toBe(25)
    expect(parseCapInput(" 25 ")).toBe(25)
  })
  it("aceita vírgula decimal pt-BR ('12,50' → 12.5)", () => {
    expect(parseCapInput("12,50")).toBe(12.5)
    expect(parseCapInput("0.5")).toBe(0.5)
  })
  it("vazio e 0 = SEM teto (null — estado válido do checkBudget)", () => {
    expect(parseCapInput("")).toBeNull()
    expect(parseCapInput("   ")).toBeNull()
    expect(parseCapInput("0")).toBeNull()
    expect(parseCapInput("0,00")).toBeNull()
  })
  it("inválido (NaN/negativo/∞) → undefined (caller mantém o anterior)", () => {
    expect(parseCapInput("abc")).toBeUndefined()
    expect(parseCapInput("-3")).toBeUndefined()
    expect(parseCapInput("1/2")).toBeUndefined()
    expect(parseCapInput("Infinity")).toBeUndefined()
  })
})

describe("draftDirty (guarda anti miss-click do fechar)", () => {
  it("texto igual ao pré-preenchido do composer, sem anexos/edições → limpo", () => {
    expect(
      draftDirty({ task: "  fazer x ", initialTask: "fazer x", attachmentCount: 0, customized: false }),
    ).toBe(false)
  })
  it("texto digitado diferente → sujo", () => {
    expect(
      draftDirty({ task: "fazer y", initialTask: "fazer x", attachmentCount: 0, customized: false }),
    ).toBe(true)
  })
  it("anexos pendentes → sujo", () => {
    expect(draftDirty({ task: "", attachmentCount: 1, customized: false })).toBe(true)
  })
  it("fases personalizadas → sujo", () => {
    expect(draftDirty({ task: "", attachmentCount: 0, customized: true })).toBe(true)
  })
})
