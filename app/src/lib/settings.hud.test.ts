import { describe, expect, it } from "vitest"
import { DEFAULT_SETTINGS } from "@/lib/settings"

describe("configurações do instrumento da bandeja", () => {
  it("é opt-in e não aparece na tela sem decisão da pessoa", () => {
    expect(DEFAULT_SETTINGS.hudEnabled).toBe(false)
  })

  it("prefere o notch quando a pessoa liga o instrumento", () => {
    expect(DEFAULT_SETTINGS.hudPosition).toBe("notch")
  })

  it("inicia com expansão no hover habilitada por padrão", () => {
    expect(DEFAULT_SETTINGS.hudHoverExpand).toBe(true)
  })

  it("inicia com perseguição de tela ativa em multi-monitores", () => {
    expect(DEFAULT_SETTINGS.hudFollowActiveScreen).toBe(true)
  })
})
