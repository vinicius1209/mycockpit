import { describe, expect, it } from "vitest"
import { DEFAULT_MISSION_PRESETS } from "./missionDefaults"
import { reconcileMissionPresets } from "./settings"

describe("reconcileMissionPresets", () => {
  it("instala os planos de fábrica quando não há biblioteca persistida", () => {
    expect(reconcileMissionPresets(undefined).map((plan) => plan.id)).toEqual(
      DEFAULT_MISSION_PRESETS.map((plan) => plan.id),
    )
  })

  it("substitui um plano de fábrica antigo sem tocar nos planos do usuário", () => {
    const custom = {
      ...DEFAULT_MISSION_PRESETS[0],
      id: "meu-plano",
      name: "Meu plano",
      revision: 1,
    }
    const oldFactory = {
      ...DEFAULT_MISSION_PRESETS[0],
      revision: 1,
      factoryRevision: undefined,
      graph: undefined,
      mode: "linear" as const,
      phases: DEFAULT_MISSION_PRESETS[0].phases.slice(0, 3),
    }
    const result = reconcileMissionPresets([oldFactory, custom])
    const upgraded = result.find((plan) => plan.id === oldFactory.id)
    expect(upgraded?.revision).toBe(2)
    expect(upgraded?.graph?.nodes).toHaveLength(4)
    expect(result.find((plan) => plan.id === custom.id)).toBe(custom)
  })

  it("preserva uma edição do usuário diante de uma fábrica futura", () => {
    const edited = {
      ...DEFAULT_MISSION_PRESETS[0],
      revision: 3,
      name: "Minha Feature completa",
    }
    const futureFactory = {
      ...DEFAULT_MISSION_PRESETS[0],
      revision: 3,
      factoryRevision: 3,
      name: "Feature completa v3",
    }
    expect(
      reconcileMissionPresets([edited], [futureFactory]).find(
        (plan) => plan.id === edited.id,
      ),
    ).toBe(edited)
  })

  it("plano LEGADO que o usuário editou sobrevive a uma fábrica futura", () => {
    // O caso que faltava, e ele DESTRUÍA a edição em silêncio: plano salvo
    // antes de `factoryRevision` existir (undefined) e depois editado, então
    // `revision` subiu pra 2 pelo patchPlan. A base era inferida do próprio
    // revision, o que fazia toda edição parecer intacta.
    const legadoEditado = {
      ...DEFAULT_MISSION_PRESETS[0],
      factoryRevision: undefined,
      revision: 2,
      name: "MEU NOME CUSTOMIZADO",
    }
    const fabricaFutura = {
      ...DEFAULT_MISSION_PRESETS[0],
      revision: 3,
      factoryRevision: 3,
      name: "Fábrica v3",
    }
    const r = reconcileMissionPresets([legadoEditado], [fabricaFutura])
    expect(r[0].name).toBe("MEU NOME CUSTOMIZADO")
  })

  it("plano legado INTACTO ainda recebe a atualização (o ponto da feature)", () => {
    // A trava não pode ser "nunca atualizar sem factoryRevision": TODOS os
    // planos que existem hoje são legados, e aí a feature não faria nada.
    const legadoIntacto = {
      ...DEFAULT_MISSION_PRESETS[0],
      factoryRevision: undefined,
      revision: 1,
      name: "Nome de fábrica antigo",
    }
    const fabricaNova = {
      ...DEFAULT_MISSION_PRESETS[0],
      revision: 2,
      factoryRevision: 2,
      name: "Nome de fábrica novo",
    }
    const r = reconcileMissionPresets([legadoIntacto], [fabricaNova])
    expect(r[0].name).toBe("Nome de fábrica novo")
  })
})
