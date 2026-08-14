// A REGRA DE PROMOÇÃO do M3 (docs/model-autonomy-plan.md), testada onde ela
// mora: pura, sem banco e sem CLI.
//
// As fixtures são as respostas REAIS desta máquina em 14/08/2026 (ADR-016):
// o `model/list` do codex-cli 0.147.0 (com o `upgrade`/`migrationMarkdown` que
// o M2 achou) e os desfechos que a fumaça carimbou de verdade.

import { describe, expect, it } from "vitest"
import { agentModels, defaultModelFor, setApprovedModels } from "@/lib/agents"
import type { ModelProposal, ModelRetirement } from "@/lib/modelLedger"
import type { ModelListing } from "@/lib/modelList"
import type { SmokeResult } from "@/lib/modelSmoke"
import {
  modelNews,
  pickSmokeCandidates,
  promotionCall,
  retirementNotices,
  type PriceRead,
} from "./modelPromotion"

const LISTA_CODEX: ModelListing = {
  agent: "codex",
  source: "codex-app-server",
  cliVersion: "0.147.0",
  fetchedAt: 1_786_000_000_000,
  models: [
    {
      id: "gpt-5.6-luna",
      label: "GPT-5.6-Luna",
      description: "Fast and cheap.",
      hidden: false,
      isDefault: false,
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

const PRECO: PriceRead = {
  kind: "found",
  input: 1,
  output: 6,
  fromCatalog: false,
}

function fumaca(over: Partial<SmokeResult>): SmokeResult {
  return {
    agent: "codex",
    model: "gpt-5.6-luna",
    outcome: "ok",
    detail: "turn.completed",
    cliVersion: "0.147.0",
    contextWindow: null,
    catalogContext: null,
    canonicalModel: null,
    checkedAt: 1_786_000_000_000,
    ...over,
  }
}

describe("a regra das três pernas", () => {
  it("passou nas três, entra sozinho no seletor", () => {
    const call = promotionCall({
      agent: "codex",
      value: "gpt-5.6-luna",
      listing: LISTA_CODEX,
      smoke: fumaca({}),
      price: PRECO,
    })
    expect(call.decision).toBe("promote")
    expect(call.reason).toContain("Entrou sozinho")
    // A evidência é a frase do PRÓPRIO CLI, não a nossa paráfrase.
    expect(call.evidence).toBe("turn.completed")
    expect(call.legs.every((l) => l.verdict === "pass")).toBe(true)
  })

  it("o CLI não conhece o slug, então não entra, e o motivo é esse", () => {
    const call = promotionCall({
      agent: "codex",
      value: "gpt-5.6", // ID de API, o CLI não lista (verificado 14/08/2026)
      listing: LISTA_CODEX,
      smoke: fumaca({ model: "gpt-5.6", outcome: "unknown-slug", detail: "Model metadata for `gpt-5.6` not found" }),
      price: PRECO,
    })
    expect(call.decision).toBe("reject")
    expect(call.reason).toContain("não reconhece")
    expect(call.evidence).toContain("not found")
  })

  it("a autenticação não alcança o slug, então não entra, e o motivo é esse", () => {
    const call = promotionCall({
      agent: "codex",
      value: "gpt-5.6-luna",
      listing: LISTA_CODEX,
      smoke: fumaca({ outcome: "auth-rejected", detail: "403" }),
      price: PRECO,
    })
    expect(call.decision).toBe("reject")
    expect(call.reason).toContain("autenticação")
  })

  it("sem preço não entra: turno sem estimativa de custo é o que a perna evita", () => {
    const call = promotionCall({
      agent: "codex",
      value: "gpt-5.6-luna",
      listing: LISTA_CODEX,
      smoke: fumaca({}),
      price: { kind: "none" },
    })
    expect(call.decision).toBe("reject")
    expect(call.reason).toContain("sem estimativa de custo")
  })

  it("modelo que o CLI esconde do picker dele não entra sozinho", () => {
    const call = promotionCall({
      agent: "codex",
      value: "gpt-5.6-sol-wm",
      listing: LISTA_CODEX,
      smoke: fumaca({ model: "gpt-5.6-sol-wm" }),
      price: PRECO,
    })
    expect(call.decision).toBe("reject")
    expect(call.reason).toContain("não o oferece na lista padrão")
  })
})

describe("'não sei' nunca promove nem rebaixa", () => {
  it("sem lista viva (motor sem fonte) o candidato fica PENDENTE, não reprovado", () => {
    // O claude-code não sabe listar modelos (M1). Reprovar por uma pergunta que
    // ninguém pôde fazer seria condenar por ignorância: ele segue no gate.
    const call = promotionCall({
      agent: "claude-code",
      value: "claude-fable-5",
      listing: null,
      smoke: fumaca({ agent: "claude-code", model: "claude-fable-5" }),
      price: PRECO,
    })
    expect(call.decision).toBe("pending")
    expect(call.reason).toContain("Falta conferir")
    expect(call.reason).toContain("nada mudou")
  })

  it("fumaça que não concluiu deixa pendente, nunca reprovado", () => {
    const call = promotionCall({
      agent: "codex",
      value: "gpt-5.6-luna",
      listing: LISTA_CODEX,
      smoke: fumaca({ outcome: "unreachable", detail: "spawn falhou" }),
      price: PRECO,
    })
    expect(call.decision).toBe("pending")
  })

  it("nunca testado é pendente, e a frase diz o que falta", () => {
    const call = promotionCall({
      agent: "codex",
      value: "gpt-5.6-luna",
      listing: LISTA_CODEX,
      smoke: null,
      price: PRECO,
    })
    expect(call.decision).toBe("pending")
    expect(call.reason).toContain("Ainda não foi testado")
  })

  it("preço que não deu pra consultar segura o candidato, não o condena", () => {
    const call = promotionCall({
      agent: "codex",
      value: "gpt-5.6-luna",
      listing: LISTA_CODEX,
      smoke: fumaca({}),
      price: { kind: "unknown", message: "sem app" },
    })
    expect(call.decision).toBe("pending")
  })

  it("o que reprova é o VEREDITO, mesmo com outra perna em 'não sei'", () => {
    // Lista desconhecida + fumaça negativa: o "não sei" não salva nem afunda,
    // quem decide é a perna que respondeu.
    const call = promotionCall({
      agent: "claude-code",
      value: "claude-naoexiste-9-9",
      listing: null,
      smoke: fumaca({
        agent: "claude-code",
        model: "claude-naoexiste-9-9",
        outcome: "unknown-slug",
        detail: "It may not exist or you may not have access to it",
      }),
      price: PRECO,
    })
    expect(call.decision).toBe("reject")
    expect(call.reason).toContain("não reconhece")
  })
})

describe("quem vai pra fumaça (o teto que protege a quota)", () => {
  const historico = [
    fumaca({ model: "gpt-5.6-luna", outcome: "ok", cliVersion: "0.147.0" }),
    fumaca({ model: "gpt-5.5", outcome: "unreachable", cliVersion: "0.147.0" }),
  ]

  it("só candidato NOVO gasta token; quem já tem veredito não é re-testado", () => {
    const pick = pickSmokeCandidates(
      ["gpt-5.6-luna", "gpt-5.6-terra"],
      historico,
      "codex",
      "0.147.0",
      3,
    )
    expect(pick).toEqual(["gpt-5.6-terra"])
  })

  it("'não sei' carimbado volta pra fila: a pergunta segue sem resposta", () => {
    const pick = pickSmokeCandidates(["gpt-5.5"], historico, "codex", "0.147.0", 3)
    expect(pick).toEqual(["gpt-5.5"])
  })

  it("versão nova do CLI re-abre a pergunta (o veredito era sobre outro binário)", () => {
    const pick = pickSmokeCandidates(
      ["gpt-5.6-luna"],
      historico,
      "codex",
      "0.148.0",
      3,
    )
    expect(pick).toEqual(["gpt-5.6-luna"])
  })

  it("sem versão de CLI pra comparar, não re-testa: na dúvida, não gasta", () => {
    const pick = pickSmokeCandidates(["gpt-5.6-luna"], historico, "codex", null, 3)
    expect(pick).toEqual([])
  })

  it("o teto por rodada é teto de verdade", () => {
    const pick = pickSmokeCandidates(["a", "b", "c", "d"], [], "codex", null, 3)
    expect(pick).toEqual(["a", "b", "c"])
  })
})

describe("aposentadoria explicada pelo fornecedor", () => {
  it("o aviso traz o sucessor e o texto do próprio fornecedor", () => {
    const avisos = retirementNotices(LISTA_CODEX, ["gpt-5.4"], [])
    expect(avisos).toHaveLength(1)
    expect(avisos[0].successor).toBe("gpt-5.6-terra")
    expect(avisos[0].reason).toContain("gpt-5.6-terra")
    expect(avisos[0].reason).toContain("will be deprecated soon")
  })

  it("se você está com ele escolhido, o aviso diz ONDE, e que nada muda sozinho", () => {
    const avisos = retirementNotices(
      LISTA_CODEX,
      [],
      [
        { agent: "codex", model: "gpt-5.4", where: "conversa Refatorar o composer" },
        { agent: "codex", model: "gpt-5.4", where: "persona Revisor" },
      ],
    )
    expect(avisos[0].usedIn).toEqual([
      "conversa Refatorar o composer",
      "persona Revisor",
    ])
    expect(avisos[0].reason).toContain(
      "conversa Refatorar o composer e persona Revisor",
    )
    expect(avisos[0].reason).toContain("nada muda sozinho")
  })

  it("slug aposentado que não é seu não vira aviso: nunca esteve no seu seletor", () => {
    expect(retirementNotices(LISTA_CODEX, ["gpt-5.6-luna"], [])).toEqual([])
  })

  it("sem lista viva não se inventa aposentadoria", () => {
    expect(retirementNotices(null, ["gpt-5.4"], [])).toEqual([])
  })
})

describe("o aviso no sino", () => {
  const AGORA = 1_786_000_000_000

  function linha(over: Partial<ModelProposal>): ModelProposal {
    return {
      id: crypto.randomUUID(),
      agent: "codex",
      value: "gpt-5.6-luna",
      label: "GPT-5.6-Luna",
      description: "",
      status: "active",
      origin: "cli",
      decidedBy: "app",
      reason: "Entrou sozinho.",
      evidence: null,
      successor: null,
      createdAt: AGORA,
      decidedAt: AGORA,
      ...over,
    }
  }

  const APOSENTADO: ModelRetirement = {
    agent: "codex",
    value: "gpt-5.4",
    successor: "gpt-5.6-terra",
    vendorNote: "GPT-5.4 will be deprecated soon",
    reason:
      "O CLI anuncia que este modelo será aposentado e indica gpt-5.6-terra no lugar.",
    seenAt: AGORA,
  }

  it("os promovidos viram UMA linha por motor, com a contagem", () => {
    const itens = modelNews(
      [linha({}), linha({ value: "gpt-5.6-terra" })],
      [],
      AGORA,
    )
    expect(itens).toHaveLength(1)
    expect(itens[0].title).toBe("2 modelos novos validados e disponíveis")
    expect(itens[0].detail).toContain("gpt-5.6-luna, gpt-5.6-terra")
  })

  it("o que falhou aparece com o motivo, um por um", () => {
    const itens = modelNews(
      [
        linha({
          value: "gpt-5.6",
          status: "rejected",
          reason: "Este CLI não reconhece o modelo.",
        }),
      ],
      [],
      AGORA,
    )
    expect(itens[0].tone).toBe("blocked")
    expect(itens[0].title).toContain("não entrou no seletor")
    expect(itens[0].detail).toContain("não reconhece")
  })

  it("aposentadoria vem primeiro: ela mexe com o que você já usa", () => {
    const itens = modelNews(
      [linha({}), linha({ value: "gpt-5.6", status: "rejected", reason: "sem preço" })],
      [APOSENTADO],
      AGORA,
    )
    expect(itens.map((i) => i.tone)).toEqual(["retired", "blocked", "new"])
    expect(itens[0].detail).toContain("gpt-5.6-terra")
  })

  it("o que VOCÊ aprovou no gate não vira notícia de 'entrou sozinho'", () => {
    expect(modelNews([linha({ decidedBy: "human" })], [], AGORA)).toEqual([])
  })

  it("notícia envelhece e sai do sino; o estado fica em Configurações", () => {
    const velho = AGORA - 8 * 24 * 60 * 60 * 1000
    expect(modelNews([linha({ decidedAt: velho })], [], AGORA)).toEqual([])
    expect(
      modelNews([], [{ ...APOSENTADO, seenAt: velho }], AGORA),
    ).toEqual([])
  })

  it("dispensar silencia AQUELE aviso, não o de amanhã com outro modelo", () => {
    const um = modelNews([linha({})], [], AGORA)
    const dispensado = { [um[0].id]: AGORA }
    expect(modelNews([linha({})], [], AGORA, dispensado)).toEqual([])
    // Chegou outro modelo: a assinatura muda e o aviso volta a aparecer.
    const depois = modelNews(
      [linha({}), linha({ value: "gpt-5.6-terra" })],
      [],
      AGORA,
      dispensado,
    )
    expect(depois).toHaveLength(1)
  })

  it("pendente não vira notícia: limbo não é novidade nem recusa", () => {
    expect(modelNews([linha({ status: "proposed" })], [], AGORA)).toEqual([])
  })
})

describe("§5 do plano: modelo novo NUNCA vira o seu padrão sozinho", () => {
  it("promover ADICIONA uma opção no fim da lista e não toca no padrão", () => {
    const antes = agentModels("codex").map((o) => o.value)
    const padraoAntes = defaultModelFor("codex")
    // É exatamente isto que a promoção faz: alimenta o cache de aprovados.
    setApprovedModels("codex", [
      { value: "gpt-5.7-nova", label: "GPT-5.7-Nova" },
    ])
    const depois = agentModels("codex").map((o) => o.value)
    expect(depois.slice(0, antes.length)).toEqual(antes) // nada foi reordenado
    expect(depois[depois.length - 1]).toBe("gpt-5.7-nova") // entrou no fim
    expect(defaultModelFor("codex")).toBe(padraoAntes) // o padrão é seu
    setApprovedModels("codex", [])
    expect(agentModels("codex").map((o) => o.value)).toEqual(antes) // reversível
  })
})
