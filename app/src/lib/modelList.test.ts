// Régua do estado de um slug contra a lista VIVA do CLI (M1). A fixture é a
// resposta REAL do `model/list` do codex-cli 0.147.0 capturada nesta máquina
// em 14/08/2026 (ADR-016: fixture inventada esconde bug), já no formato
// camelCase que o comando Tauri devolve.

import { describe, expect, it } from "vitest"
import {
  canListModels,
  slugStanding,
  standingNote,
  toListFailure,
  type ModelListing,
} from "./modelList"

const LISTA_CODEX: ModelListing = {
  agent: "codex",
  source: "codex-app-server",
  cliVersion: "0.147.0",
  fetchedAt: 1_786_000_000_000,
  models: [
    {
      id: "gpt-5.6-sol",
      label: "GPT-5.6-Sol",
      description: "Latest frontier agentic coding model.",
      hidden: false,
      isDefault: true,
      supersededBy: null,
      retirementNote: null,
    },
    {
      id: "gpt-5.4",
      label: "GPT-5.4",
      description: "Strong model for everyday coding.",
      hidden: false,
      isDefault: false,
      supersededBy: "gpt-5.6-terra",
      retirementNote:
        "GPT-5.4 will be deprecated soon\n\nCodex now uses GPT-5.6 Terra in place of GPT-5.4. Switch to GPT-5.6 Terra to continue.",
    },
    {
      id: "gpt-5.6-sol-wm",
      label: "GPT-5.6-Sol-WM",
      description: null,
      hidden: true,
      isDefault: false,
      supersededBy: null,
      retirementNote: null,
    },
  ],
}

describe("estado de um slug segundo a lista viva do CLI", () => {
  it("slug oferecido pelo CLI está listado e não pede aviso", () => {
    expect(slugStanding(LISTA_CODEX, "gpt-5.6-sol")).toBe("listed")
    expect(standingNote("listed")).toBeNull()
  })

  it("slug com sucessor anunciado vira aposentado, com o sucessor na frase", () => {
    expect(slugStanding(LISTA_CODEX, "gpt-5.4")).toBe("retired")
    const nota = standingNote("retired", LISTA_CODEX.models[1])
    expect(nota).toContain("aposentado")
    expect(nota).toContain("gpt-5.6-terra")
  })

  it("slug escondido do picker do CLI é estado próprio, não desconhecido", () => {
    // O CLI CONHECE: chamar de desconhecido seria mentir sobre o motivo.
    expect(slugStanding(LISTA_CODEX, "gpt-5.6-sol-wm")).toBe("hidden")
  })

  it("slug ausente da lista viva é desconhecido, com aviso em vez de sumiço", () => {
    // `gpt-5.6` puro é ID de API: o CLI não o conhece (verificado 14/08/2026).
    expect(slugStanding(LISTA_CODEX, "gpt-5.6")).toBe("unknown")
    expect(standingNote("unknown")).toContain("não reconhece")
  })

  it("sem lista viva o veredito é 'não sei', nunca 'desconhecido'", () => {
    // Motor sem fonte (claude) ou sonda que falhou: nada é rebaixado.
    expect(slugStanding(null, "claude-opus-5[1m]")).toBe("unverified")
    expect(slugStanding(undefined, "qualquer")).toBe("unverified")
    expect(standingNote("unverified")).toContain("nada mudou")
  })

  it("quem sabe se listar sai do registry, nunca de nome escrito à mão", () => {
    expect(canListModels("codex")).toBe(true)
    expect(canListModels("agy")).toBe(true)
    // claude 2.1.220 não tem fonte viva (help verificado 14/08/2026).
    expect(canListModels("claude-code")).toBe(false)
    expect(canListModels("motor-que-nao-existe")).toBe(false)
  })

  it("falha da sonda chega tipada, e o que vier fora de forma não some", () => {
    expect(toListFailure({ kind: "timeout", message: "não respondeu" })).toEqual({
      kind: "timeout",
      message: "não respondeu",
    })
    expect(toListFailure("estourou feio")).toEqual({
      kind: "protocol",
      message: "estourou feio",
    })
  })
})
