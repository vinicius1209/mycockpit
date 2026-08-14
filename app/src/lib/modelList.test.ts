// Régua do estado de um slug contra a lista VIVA do CLI (M1). A fixture é a
// resposta REAL do `model/list` do codex-cli 0.147.0 capturada nesta máquina
// em 14/08/2026 (ADR-016: fixture inventada esconde bug), já no formato
// camelCase que o comando Tauri devolve.

import { describe, expect, it } from "vitest"
import {
  agyModelOptions,
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

// ── lista viva do agy → opções do picker (regressão de 14/08/2026) ──────────
//
// O `agy models` é TSV `slug<TAB>Rótulo`. Um parser velho (o extinto
// `detect::parse_model_lines`) devolvia a LINHA INTEIRA como slug, o valor foi
// parar no seletor e o agy recusou LOCALMENTE todo envio:
//   invalid model selection (--model "gemini-3.7-flash-high\tGemini 3.7 Flash
//   (High)" --effort ""): model … is not recognized as a known model

describe("agyModelOptions", () => {
  it("usa o slug como value e o rótulo do CLI como label, nunca a linha toda", () => {
    // Slugs REAIS do `agy models` (agy 1.1.13). O 3.7 ainda não está no
    // catálogo curado, então é aqui que se vê o rótulo do CLI estreando.
    const options = agyModelOptions([
      { id: "gemini-3.7-flash-high", label: "Gemini 3.7 Flash (High)" },
      { id: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)" },
    ])
    expect(options[0].value).toBe("default") // "Padrão" segue na frente
    expect(options[1]).toEqual({
      value: "gemini-3.7-flash-high",
      label: "Gemini 3.7 Flash (High)",
    })
    expect(options.every((o) => !/\s/.test(o.value))).toBe(true)
  })

  it("slug do catálogo curado mantém o rótulo de casa", () => {
    const options = agyModelOptions([
      { id: "gemini-3.6-flash-low", label: "Gemini 3.6 Flash (Low)" },
    ])
    expect(options[1].label).toBe("Flash 3.6 (Low)")
    expect(options[1].description).toContain("Rápido")
  })

  it("slug sujo (rótulo colado) não vira opção do seletor", () => {
    // Opção que só produz "model … is not recognized" no CLI não é oferta.
    const options = agyModelOptions([
      { id: "gemini-3.7-flash-high\tGemini 3.7 Flash (High)", label: "" },
      { id: "  ", label: "vazio" },
      { id: "gemini-3.7-flash-low", label: "Gemini 3.7 Flash (Low)" },
    ])
    expect(options.map((o) => o.value)).toEqual([
      "default",
      "gemini-3.7-flash-low",
    ])
  })
})
