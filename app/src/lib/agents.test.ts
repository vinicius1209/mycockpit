import { afterEach, describe, expect, it } from "vitest"
import {
  agentModels,
  availability,
  dispatchBlockReason,
  normalizeAgyModel,
  agentEfforts,
  normalizeModelValue,
  setApprovedModels,
  setLiveModels,
} from "@/lib/agents"
import { liveModelOptions, liveModelsFrom } from "@/lib/modelList"
import type { AgentProbe } from "@/lib/detect"

afterEach(() => {
  setLiveModels("agy", null)
  setLiveModels("codex", null)
  setApprovedModels("codex", [])
})

describe("modelos do agy", () => {
  it("normaliza ids legados persistidos para kebab-case", () => {
    // 3.5-flash-low voltou ao `agy models` na CLI 1.1.5 → mapeia 1:1 de novo.
    expect(normalizeAgyModel("Gemini 3.5 Flash (Low)")).toBe(
      "gemini-3.5-flash-low",
    )
    expect(normalizeAgyModel("gemini-3.6-flash-low")).toBe(
      "gemini-3.6-flash-low",
    )
  })

  it("normalizeModelValue remapeia legados por agent e preserva o resto", () => {
    // codex: ids que saíram do catálogo do CLI (400 com auth ChatGPT)
    expect(normalizeModelValue("codex", "gpt-5.3-codex")).toBe("gpt-5.5")
    expect(normalizeModelValue("codex", "o3")).toBe("gpt-5.5")
    expect(normalizeModelValue("codex", "gpt-5.6-sol")).toBe("gpt-5.6-sol")
    // claude: alias 1M legado converge pro pin de topo do picker atual (Opus 5)
    expect(normalizeModelValue("claude-code", "opus[1m]")).toBe(
      "claude-opus-5[1m]",
    )
    expect(normalizeModelValue("claude-code", "opus")).toBe("opus")
    // agy delega pro remap existente; default/null passam intactos
    expect(normalizeModelValue("agy", "Gemini 3.1 Pro (High)")).toBe(
      "gemini-3.1-pro-high",
    )
    expect(normalizeModelValue("codex", "default")).toBe("default")
    expect(normalizeModelValue("codex", null)).toBeNull()
  })

  it("preserva Padrão e não duplica ids da lista viva", () => {
    const entrada = (id: string) => ({
      id,
      label: "Gemini 3.6 Flash (Low)",
      description: null,
      hidden: false,
      isDefault: false,
      supersededBy: null,
      retirementNote: null,
      efforts: [],
      defaultEffort: null,
    })
    const dynamic = liveModelOptions("agy", [
      entrada("gemini-3.6-flash-low"),
      entrada("gemini-3.6-flash-low"),
      entrada("default"),
    ])
    setLiveModels("agy", {
      models: [...dynamic, dynamic[1]],
      efforts: new Map(),
      known: new Set(["gemini-3.6-flash-low"]),
    })
    expect(agentModels("agy").map((option) => option.value)).toEqual([
      "default",
      "gemini-3.6-flash-low",
    ])
  })

  it("saneia slug já persistido com rótulo colado, sem chutar rótulo puro", () => {
    // Conversa/agenda gravada durante o bug volta executável na leitura.
    expect(
      normalizeModelValue("agy", "gemini-3.7-flash-high\tGemini 3.7 Flash (High)"),
    ).toBe("gemini-3.7-flash-high")
    // Vale pra qualquer motor: a regra é do transporte, não do fornecedor.
    expect(normalizeModelValue("codex", "gpt-5.6-sol\tSol")).toBe("gpt-5.6-sol")
    // Rótulo PURO desconhecido não é adivinhado (viraria um slug limpo e
    // errado); segue inteiro e a fronteira no Rust recusa com motivo.
    expect(normalizeModelValue("agy", "Gemini 3.6 Flash (High)")).toBe(
      "Gemini 3.6 Flash (High)",
    )
    // Rótulo legado MAPEADO continua convergindo (o remap vem antes do corte).
    expect(normalizeModelValue("agy", "Gemini 3.5 Flash (Low)")).toBe(
      "gemini-3.5-flash-low",
    )
  })
})

// ── availability(): registry estático × detecção runtime (auth honesta) ─────

function probe(patch: Partial<AgentProbe> = {}): AgentProbe {
  return {
    installed: true,
    version: "1.0.0",
    auth: "ok",
    detail: null,
    latest: null,
    checkedAt: 0,
    ...patch,
  }
}

describe("availability", () => {
  it("instalado e logado (auth ok) é ready", () => {
    expect(availability("claude-code", { "claude-code": probe() })).toBe("ready")
  })

  it("instalado e DESLOGADO (auth missing) é installed-not-authenticated", () => {
    expect(
      availability("claude-code", {
        "claude-code": probe({ auth: "missing" }),
      }),
    ).toBe("installed-not-authenticated")
  })

  it("auth indeterminada (unknown) degrada pra installed-auth-unknown, não pra deslogado", () => {
    // caso agy: a CLI não tem comando de auth — nunca reporta "missing", então
    // "deslogado" não é prometido pra ela.
    expect(availability("agy", { agy: probe({ auth: "unknown" }) })).toBe(
      "installed-auth-unknown",
    )
  })

  it("não instalado é missing", () => {
    expect(
      availability("codex", {
        codex: probe({ installed: false, version: null, auth: "missing" }),
      }),
    ).toBe("missing")
  })

  it("sem snapshot de detecção degrada pra installed-auth-unknown (usável, mas sem prometer pronto)", () => {
    // F-C: sem probe não há EVIDÊNCIA de prontidão — a mesa não acende "ready"
    // por omissão (detect_agents pode ter falhado no boot), mas quem nunca
    // rodou a detecção segue conseguindo despachar (degradação honesta).
    expect(availability("codex", {})).toBe("installed-auth-unknown")
  })

  it("agent que o app não integra é not-integrated, com ou sem probe", () => {
    expect(availability("model", {})).toBe("not-integrated")
    expect(availability("desconhecido", { desconhecido: probe() })).toBe(
      "not-integrated",
    )
  })

  it("auth na (sem conceito de auth) segue usável como installed-auth-unknown", () => {
    // preserva o comportamento pré-Sprint 0 pra ferramentas sem auth checável.
    expect(availability("codex", { codex: probe({ auth: "na" }) })).toBe(
      "installed-auth-unknown",
    )
  })
})

// ── dispatchBlockReason(): guarda de despacho (follow-up F-A do Sprint 0) ────

describe("dispatchBlockReason", () => {
  it("CLI deslogada bloqueia o despacho com instrução de login pelo terminal", () => {
    const reason = dispatchBlockReason("codex", {
      codex: probe({ auth: "missing" }),
    })
    expect(reason).toContain("Codex")
    expect(reason).toContain("sem login")
    expect(reason).toContain("terminal")
  })

  it("CLI não instalada bloqueia com o motivo honesto", () => {
    const reason = dispatchBlockReason("claude-code", {
      "claude-code": probe({ installed: false, version: null, auth: "missing" }),
    })
    expect(reason).toContain("Claude Code")
    expect(reason).toContain("não está instalado")
  })

  it("agent não integrado bloqueia", () => {
    expect(dispatchBlockReason("model", {})).toContain("não é integrado")
  })

  it("ready passa; auth incerta (inclusive SEM probe) também passa — degradação honesta", () => {
    expect(dispatchBlockReason("claude-code", { "claude-code": probe() })).toBeNull()
    expect(dispatchBlockReason("agy", { agy: probe({ auth: "unknown" }) })).toBeNull()
    expect(dispatchBlockReason("codex", {})).toBeNull()
  })
})

describe("régua de esforço por modelo", () => {
  // O CLI é quem sabe: em 09/09/2026 o codex aceitava `ultra` no gpt-6-astra e
  // parava em `xhigh` no gpt-5.5. Uma régua só por MOTOR não podia estar certa
  // nos dois, e o erro só aparecia quando o turno morria.
  const listing = {
    agent: "codex",
    source: "codex-app-server",
    cliVersion: "0.153.4",
    fetchedAt: 1_788_000_000_000,
    models: [
      {
        id: "gpt-6-astra",
        label: "GPT-6-Astra",
        description: null,
        hidden: false,
        isDefault: true,
        supersededBy: null,
        retirementNote: null,
        efforts: [
          { id: "medium", description: null },
          { id: "ultra", description: null },
        ],
        defaultEffort: "medium",
      },
    ],
  }

  it("com modelo escolhido, a régua é a que o CLI declarou pra ele", () => {
    setLiveModels("codex", liveModelsFrom(listing))
    expect(agentEfforts("codex", "gpt-6-astra").map((o) => o.value)).toEqual([
      "default",
      "medium",
      "ultra",
    ])
  })

  it("sem lista viva, ou sem modelo, a régua do registry continua valendo", () => {
    // "Não sei" nunca esvazia o seletor: é a mesma assimetria do M3.
    setLiveModels("codex", liveModelsFrom(listing))
    expect(agentEfforts("codex").length).toBeGreaterThan(0)
    expect(agentEfforts("codex", "modelo-que-o-cli-nao-lista").length).toBeGreaterThan(0)
    setLiveModels("codex", null)
    expect(agentEfforts("codex", "gpt-6-astra").length).toBeGreaterThan(0)
  })
})

describe("o que a lista viva não conhece não é oferecido", () => {
  // Regressão de 09/09/2026: `gpt-5.6` e `gpt-realtime-2.1` entraram pelo
  // curador (catálogo de API) e foram aprovados no gate, mas o `model/list` do
  // codex nunca conheceu nenhum dos dois. Ficaram meses no seletor produzindo
  // erro no envio. Oferecer o que não existe é teatro.
  const vivo = (ids: string[], known = ids) => ({
    models: ids.map((value) => ({ value, label: value })),
    efforts: new Map(),
    known: new Set(known),
  })

  it("aprovado que o CLI não conhece sai do seletor", () => {
    setLiveModels(
      "codex",
      vivo(["gpt-6-astra"], ["gpt-6-astra", "gpt-5.3-codex-spark"]),
    )
    setApprovedModels("codex", [
      { value: "gpt-realtime-2.1", label: "Rápido Econômico" },
      { value: "gpt-5.3-codex-spark", label: "Spark" },
    ])
    expect(agentModels("codex").map((o) => o.value)).toEqual([
      "gpt-6-astra",
      "gpt-5.3-codex-spark",
    ])
  })

  it("slug que o CLI conhece mas ESCONDE segue oferecível se você aprovou", () => {
    // "Conhecer" é mais largo que "oferecer": o escondido funciona quando
    // escolhido, e tratá-lo como inexistente apagaria um gesto seu.
    setLiveModels("codex", vivo(["gpt-6-astra"], ["gpt-6-astra", "gpt-reserve"]))
    setApprovedModels("codex", [{ value: "gpt-reserve", label: "Reserve" }])
    expect(agentModels("codex").map((o) => o.value)).toContain("gpt-reserve")
  })

  it("sem lista viva nada é filtrado: 'não sei' nunca rebaixa", () => {
    setApprovedModels("codex", [{ value: "gpt-realtime-2.1", label: "Rápido" }])
    expect(agentModels("codex").map((o) => o.value)).toContain("gpt-realtime-2.1")
  })
})
