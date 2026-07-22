// P2 da auditoria de modelos: ledger de resoluções observadas — o app aprende
// a resolução real de cada pedido a cada evento `session` (não há enumeração
// headless no claude CLI; observação passiva é a fonte robusta).
import { beforeEach, describe, expect, it } from "vitest"
import { useApp } from "@/store/app"

beforeEach(() => {
  useApp.setState((s) => ({
    settings: { ...s.settings, observedResolutions: {} },
  }))
})

describe("recordResolution (ledger)", () => {
  it("primeira observação grava e devolve null", () => {
    const prev = useApp
      .getState()
      .recordResolution("claude-code", "opus", "claude-opus-4-8")
    expect(prev).toBeNull()
    expect(
      useApp.getState().settings.observedResolutions["claude-code"].opus
        .resolved,
    ).toBe("claude-opus-4-8")
  })

  it("mesma resolução não regrava (o `at` marca a 1ª observação)", () => {
    useApp.getState().recordResolution("claude-code", "opus", "claude-opus-4-8")
    const at1 =
      useApp.getState().settings.observedResolutions["claude-code"].opus.at
    const prev = useApp
      .getState()
      .recordResolution("claude-code", "opus", "claude-opus-4-8")
    expect(prev).toBe("claude-opus-4-8")
    expect(
      useApp.getState().settings.observedResolutions["claude-code"].opus.at,
    ).toBe(at1)
  })

  it("mudança de resolução devolve a anterior (gatilho do aliasShiftNotice)", () => {
    useApp.getState().recordResolution("claude-code", "opus", "claude-opus-4-7")
    const prev = useApp
      .getState()
      .recordResolution("claude-code", "opus", "claude-opus-4-8")
    expect(prev).toBe("claude-opus-4-7")
    expect(
      useApp.getState().settings.observedResolutions["claude-code"].opus
        .resolved,
    ).toBe("claude-opus-4-8")
  })

  it("pedido null vira a chave 'default'; resolvido null é no-op", () => {
    useApp.getState().recordResolution("codex", null, "gpt-5.6-sol")
    expect(
      useApp.getState().settings.observedResolutions.codex.default.resolved,
    ).toBe("gpt-5.6-sol")
    expect(useApp.getState().recordResolution("codex", "x", null)).toBeNull()
    expect(
      useApp.getState().settings.observedResolutions.codex.x,
    ).toBeUndefined()
  })
})
