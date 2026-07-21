import { afterEach, describe, expect, it } from "vitest"
import {
  agentModels,
  agyModelOptions,
  normalizeAgyModel,
  setDynamicModels,
} from "@/lib/agents"

afterEach(() => setDynamicModels("agy", []))

describe("modelos do agy", () => {
  it("normaliza ids legados persistidos para kebab-case", () => {
    expect(normalizeAgyModel("Gemini 3.5 Flash (Low)")).toBe(
      "gemini-3.5-flash-medium",
    )
    expect(normalizeAgyModel("gemini-3.6-flash-low")).toBe(
      "gemini-3.6-flash-low",
    )
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
