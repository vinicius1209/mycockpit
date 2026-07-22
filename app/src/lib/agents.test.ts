import { afterEach, describe, expect, it } from "vitest"
import {
  agentModels,
  agyModelOptions,
  normalizeAgyModel,
  normalizeModelValue,
  setDynamicModels,
} from "@/lib/agents"

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
