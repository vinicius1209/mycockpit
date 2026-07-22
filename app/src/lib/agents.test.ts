import { afterEach, describe, expect, it } from "vitest"
import {
  agentModels,
  agyModelOptions,
  availability,
  normalizeAgyModel,
  normalizeModelValue,
  setDynamicModels,
} from "@/lib/agents"
import type { AgentProbe } from "@/lib/detect"

afterEach(() => setDynamicModels("agy", []))

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
    // claude: alias 1M legado converge pro pin do picker atual
    expect(normalizeModelValue("claude-code", "opus[1m]")).toBe(
      "claude-opus-4-8[1m]",
    )
    expect(normalizeModelValue("claude-code", "opus")).toBe("opus")
    // agy delega pro remap existente; default/null passam intactos
    expect(normalizeModelValue("agy", "Gemini 3.1 Pro (High)")).toBe(
      "gemini-3.1-pro-high",
    )
    expect(normalizeModelValue("codex", "default")).toBe("default")
    expect(normalizeModelValue("codex", null)).toBeNull()
  })

  it("preserva Padrão e não duplica ids da lista dinâmica", () => {
    const dynamic = agyModelOptions([
      "gemini-3.6-flash-low",
      "gemini-3.6-flash-low",
      "default",
    ])
    setDynamicModels("agy", [...dynamic, dynamic[1]])
    expect(agentModels("agy").map((option) => option.value)).toEqual([
      "default",
      "gemini-3.6-flash-low",
    ])
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

  it("sem snapshot de detecção degrada pra ready (não bloqueia quem nunca detectou)", () => {
    expect(availability("codex", {})).toBe("ready")
  })

  it("agent que o app não integra é not-integrated, com ou sem probe", () => {
    expect(availability("opencode", {})).toBe("not-integrated")
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
