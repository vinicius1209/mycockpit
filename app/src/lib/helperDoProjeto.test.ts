// A régua do helper: qual modelo vale neste projeto.
//
// O caso que desenha o módulo é o terceiro: `cfg.helper === null` é RESPOSTA
// ("este projeto desligou o helper"), não ausência. Um `??` no lugar do
// ternário passaria nos dois primeiros testes e ressuscitaria o helper num
// projeto que o desligou de propósito.

import { describe, expect, it } from "vitest"
import { resolverHelper, helperFeatureAtiva } from "./helperDoProjeto"
import { useApp } from "@/store/app"

describe("resolverHelper", () => {
  it("a config do projeto manda quando ela existe", () => {
    expect(resolverHelper({ cfg: { helper: "haiku" }, global: "sonnet" })).toBe(
      "haiku",
    )
  })

  it("sem config do projeto vale o default global", () => {
    expect(resolverHelper({ cfg: undefined, global: "haiku" })).toBe("haiku")
  })

  it("projeto que desligou o helper NÃO herda o global", () => {
    expect(resolverHelper({ cfg: { helper: null }, global: "haiku" })).toBeNull()
  })

  it("global desligado e sem config do projeto é desligado", () => {
    expect(resolverHelper({ cfg: undefined, global: null })).toBeNull()
  })
})

describe("helperFeatureAtiva", () => {
  it("desligado quando não há helper no projeto nem global", () => {
    useApp.setState({
      projectConfigs: {},
      settings: { ...useApp.getState().settings, helperModel: null },
    })
    expect(helperFeatureAtiva("conversationTitle", "p1")).toBe(false)
  })

  it("respeita a flag granular quando o helper está ativo", () => {
    useApp.setState({
      projectConfigs: {},
      settings: {
        ...useApp.getState().settings,
        helperModel: "haiku",
        helperFeatures: {
          conversationTitle: true,
          turnReceipt: false,
          composerSuggestions: true,
          learningLessons: false,
        },
      },
    })
    expect(helperFeatureAtiva("conversationTitle", "p1")).toBe(true)
    expect(helperFeatureAtiva("turnReceipt", "p1")).toBe(false)
    expect(helperFeatureAtiva("composerSuggestions", "p1")).toBe(true)
    expect(helperFeatureAtiva("learningLessons", "p1")).toBe(false)
  })
})

