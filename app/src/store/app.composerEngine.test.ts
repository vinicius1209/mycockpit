// FASE 1 do composer Lexical: o toggle `composerEngine` no store (Settings →
// Comportamento). Fallback é lei: o default tem que ser "textarea" (composer de
// produção intacto); ligar/desligar o Lexical é só um patch de settings.

import { beforeEach, describe, expect, it } from "vitest"
import { useApp } from "@/store/app"
import { DEFAULT_SETTINGS } from "@/lib/settings"

beforeEach(() => {
  // volta o settings ao default entre casos (o store é singleton de módulo).
  useApp.setState({ settings: { ...DEFAULT_SETTINGS } })
})

describe("composerEngine — motor do composer da conversa", () => {
  it("default é 'textarea' (fallback de produção intacto)", () => {
    expect(useApp.getState().settings.composerEngine).toBe("textarea")
  })

  it("ligar o Lexical é um patch parcial de settings", () => {
    useApp.getState().setSettings({ composerEngine: "lexical" })
    expect(useApp.getState().settings.composerEngine).toBe("lexical")
  })

  it("voltar pro textarea desfaz sem tocar no resto do settings", () => {
    const antes = useApp.getState().settings.defaultAgent
    useApp.getState().setSettings({ composerEngine: "lexical" })
    useApp.getState().setSettings({ composerEngine: "textarea" })
    expect(useApp.getState().settings.composerEngine).toBe("textarea")
    // o patch não mexeu em outros campos.
    expect(useApp.getState().settings.defaultAgent).toBe(antes)
  })
})
