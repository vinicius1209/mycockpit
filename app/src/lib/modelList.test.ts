// Régua do estado de um slug contra a lista VIVA do CLI (M1). A fixture é a
// resposta REAL do `model/list` do codex-cli 0.147.0 capturada nesta máquina
// em 14/08/2026 (ADR-016: fixture inventada esconde bug), já no formato
// camelCase que o comando Tauri devolve.

import { describe, expect, it } from "vitest"
import {
  canListModels,
  effortFitsModel,
  liveEffortOptions,
  liveModelOptions,
  liveModelsFrom,
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
      efforts: [
        { id: "low", description: "Fast responses with lighter reasoning" },
        { id: "medium", description: null },
        { id: "high", description: null },
        { id: "xhigh", description: null },
        { id: "max", description: null },
        { id: "ultra", description: "Maximum reasoning with automatic task delegation" },
      ],
      defaultEffort: "medium",
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
      efforts: [
        { id: "low", description: null },
        { id: "medium", description: null },
        { id: "high", description: null },
        { id: "xhigh", description: null },
      ],
      defaultEffort: "medium",
    },
    {
      id: "gpt-5.6-sol-wm",
      label: "GPT-5.6-Sol-WM",
      description: null,
      hidden: true,
      isDefault: false,
      supersededBy: null,
      retirementNote: null,
      efforts: [],
      defaultEffort: null,
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

// ── lista viva → opções do picker ─────────────────────────────────────────
//
// UMA regra pra todos os dialetos. Os dois incidentes que ela carrega:
//
//   14/08/2026 — o `agy models` é TSV `slug<TAB>Rótulo`, e um parser velho (o
//   extinto `detect::parse_model_lines`) devolvia a LINHA INTEIRA como slug. O
//   valor foi parar no seletor e o agy recusou LOCALMENTE todo envio:
//     invalid model selection (--model "gemini-3.7-flash-high\tGemini 3.7
//     Flash (High)" --effort ""): model … is not recognized as a known model
//
//   09/09/2026 — o codex passou a listar o `gpt-6-astra` como default DELE e o
//   seletor da Frota seguiu abrindo em "Sol", com dois modelos mortos na
//   frente: havia função de lista viva pro agy e pro opencode, e nunca pro
//   codex, que declarava a capability desde o M1.

/** Entrada mínima do jeito que o Rust manda (o que o dialeto não fala vem
 *  vazio, não ausente). */
function entrada(
  id: string,
  extra: Partial<ModelListing["models"][number]> = {},
): ModelListing["models"][number] {
  return {
    id,
    label: id,
    description: null,
    hidden: false,
    isDefault: false,
    supersededBy: null,
    retirementNote: null,
    efforts: [],
    defaultEffort: null,
    ...extra,
  }
}

describe("liveModelOptions", () => {
  it("usa o slug como value e o rótulo do CLI como label, nunca a linha toda", () => {
    // Slugs REAIS do `agy models` (agy 1.1.13). O 3.7 ainda não está no
    // catálogo curado, então é aqui que se vê o rótulo do CLI estreando.
    const options = liveModelOptions("agy", [
      entrada("gemini-3.7-flash-high", { label: "Gemini 3.7 Flash (High)" }),
      entrada("gpt-oss-120b-medium", { label: "GPT-OSS 120B (Medium)" }),
    ])
    expect(options[0].value).toBe("default") // "Padrão" segue na frente
    expect(options[1]).toEqual({
      value: "gemini-3.7-flash-high",
      label: "Gemini 3.7 Flash (High)",
    })
    expect(options.every((o) => !/\s/.test(o.value))).toBe(true)
  })

  it("slug do catálogo curado mantém o rótulo de casa", () => {
    const options = liveModelOptions("agy", [
      entrada("gemini-3.6-flash-low", { label: "Gemini 3.6 Flash (Low)" }),
    ])
    expect(options[1].label).toBe("Flash 3.6 (Low)")
    expect(options[1].description).toContain("Rápido")
  })

  it("slug sujo (rótulo colado) não vira opção do seletor", () => {
    // Opção que só produz "model … is not recognized" no CLI não é oferta.
    const options = liveModelOptions("agy", [
      entrada("gemini-3.7-flash-high\tGemini 3.7 Flash (High)", { label: "" }),
      entrada("  ", { label: "vazio" }),
      entrada("gemini-3.7-flash-low", { label: "Gemini 3.7 Flash (Low)" }),
    ])
    expect(options.map((o) => o.value)).toEqual([
      "default",
      "gemini-3.7-flash-low",
    ])
  })

  it("a ordem é a do CLI: modelo novo estreia no topo, sem release", () => {
    // O codex ordena por prioridade dele e o frontier vem primeiro. Reordenar
    // aqui seria o app opinando sobre um ranking que não é dele — e foi o
    // rodapé que escondeu o GPT-6 atrás de dois modelos mortos.
    const options = liveModelOptions("codex", [
      entrada("gpt-6-astra", { label: "GPT-6-Astra", isDefault: true }),
      entrada("gpt-5.6-sol", { label: "GPT-5.6-Sol" }),
    ])
    expect(options.map((o) => o.value)).toEqual([
      "default",
      "gpt-6-astra",
      "gpt-5.6-sol",
    ])
  })

  it("a sentinela diz QUEM é o default do CLI, em vez de um nome escrito à mão", () => {
    const [padrao] = liveModelOptions("codex", [
      entrada("gpt-6-astra", { label: "GPT-6-Astra", isDefault: true }),
    ])
    expect(padrao.value).toBe("default")
    expect(padrao.description).toBe("Deixa o Codex escolher (hoje GPT-6-Astra)")
  })

  it("sem default declarado, a descrição de casa fica intacta", () => {
    const [padrao] = liveModelOptions("agy", [
      entrada("gemini-3.6-flash-low", { label: "Gemini 3.6 Flash (Low)" }),
    ])
    expect(padrao.description).toBe("Deixa o agy escolher")
  })

  it("o que o CLI esconde não vira oferta, e o aposentado fica explicado", () => {
    const options = liveModelOptions("codex", LISTA_CODEX.models)
    expect(options.map((o) => o.value)).toEqual([
      "default",
      "gpt-5.6-sol",
      "gpt-5.4",
    ])
    // Sumir com opção sem aviso é o que este módulo existe pra impedir.
    expect(options[2].description).toContain("gpt-5.6-terra")
  })
})

describe("liveEffortOptions", () => {
  it("a régua é do MODELO: o mesmo motor aceita ultra num e para em xhigh no outro", () => {
    const astra = liveEffortOptions(LISTA_CODEX, "gpt-5.6-sol")
    const velho = liveEffortOptions(LISTA_CODEX, "gpt-5.4")
    expect(astra?.map((o) => o.value)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ])
    expect(velho?.map((o) => o.value)).toEqual(["low", "medium", "high", "xhigh"])
  })

  it("a copy do esforço é do CLI, e o default do modelo se anuncia", () => {
    const efforts = liveEffortOptions(LISTA_CODEX, "gpt-5.6-sol")
    expect(efforts?.[0].description).toBe("Fast responses with lighter reasoning")
    expect(efforts?.[1].description).toBe("Padrão deste modelo")
  })

  it("sem modelo, sem lista ou sem esforço declarado devolve null (cai na régua do registry)", () => {
    // null é "não sei", e é o que impede a régua de esforço de esvaziar.
    expect(liveEffortOptions(LISTA_CODEX, "default")).toBeNull()
    expect(liveEffortOptions(LISTA_CODEX, null)).toBeNull()
    expect(liveEffortOptions(null, "gpt-5.6-sol")).toBeNull()
    expect(liveEffortOptions(LISTA_CODEX, "gpt-5.6-sol-wm")).toBeNull()
  })

  it("a sentinela do registry abre a régua quando ela existe", () => {
    const efforts = liveModelsFrom(LISTA_CODEX).efforts.get("gpt-5.6-sol")
    expect(efforts?.[0].value).toBe("default")
    expect(efforts?.[0].label).toBe("Padrão")
  })
})

describe("effortFitsModel", () => {
  it("esforço fora da régua do modelo não cabe: trocar de modelo tem que soltar", () => {
    const astra = liveEffortOptions(LISTA_CODEX, "gpt-5.6-sol") ?? []
    const velho = liveEffortOptions(LISTA_CODEX, "gpt-5.4") ?? []
    expect(effortFitsModel(astra, "ultra")).toBe(true)
    expect(effortFitsModel(velho, "ultra")).toBe(false)
    expect(effortFitsModel(velho, "xhigh")).toBe(true)
  })

  it("régua vazia não derruba escolha nenhuma", () => {
    // Sem lista declarada não há o que contestar: "não sei" não rebaixa.
    expect(effortFitsModel([], "ultra")).toBe(true)
  })
})
