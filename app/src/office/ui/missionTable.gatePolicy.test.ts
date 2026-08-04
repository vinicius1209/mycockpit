// MH3.3 no formulário da MESA (Dock): a política de gate entra no rascunho
// (presetDraft), marca "personalizado" quando diverge e viaja no preset
// EFETIVO do lançamento (effectiveTablePreset/launchFromTable) — mesma régua
// do MissionLauncher do Linear.
import { describe, expect, it, vi } from "vitest"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import {
  effectiveTablePreset,
  launchFromTable,
  presetDraft,
} from "./missionTable"

function phaseDef(over: Partial<MissionPhaseDef> = {}): MissionPhaseDef {
  return {
    id: "plan",
    label: "Planejar",
    persona: "planner",
    agent: "claude-code",
    model: "opus",
    effort: null,
    maxRetries: 1,
    ...over,
  }
}

function presetOf(over: Partial<MissionPreset> = {}): MissionPreset {
  return {
    id: "feature",
    name: "Feature completa",
    maxCostUsd: 25,
    phases: [
      phaseDef(),
      phaseDef({ id: "build", label: "Executar", persona: "executor", agent: "codex", model: null }),
    ],
    ...over,
  }
}

describe("presetDraft — política de gate entra no rascunho", () => {
  it("preset sem o campo (antigo) abre como 'agente'; com o campo, o valor dele", () => {
    expect(presetDraft(presetOf()).gatePolicy).toBe("agente")
    expect(presetDraft(presetOf({ gatePolicy: "nunca" })).gatePolicy).toBe("nunca")
  })
})

describe("effectiveTablePreset — política no preset efetivo", () => {
  it("política igual à do preset: nome intacto, política viaja", () => {
    const base = presetOf({ gatePolicy: "nunca" })
    const eff = effectiveTablePreset(base, base.phases, base.maxCostUsd, "nunca")
    expect(eff.name).toBe("Feature completa")
    expect(eff.gatePolicy).toBe("nunca")
  })

  it("política DIFERENTE da do preset ⇒ '· personalizado' (política editada = rascunho custom)", () => {
    const base = presetOf() // sem campo = "agente"
    const eff = effectiveTablePreset(base, base.phases, base.maxCostUsd, "sempre-apos-planejar")
    expect(eff.name).toBe("Feature completa · personalizado")
    expect(eff.gatePolicy).toBe("sempre-apos-planejar")
  })

  it("call site antigo (sem o argumento) mantém a política do preset e não vira custom", () => {
    const base = presetOf({ gatePolicy: "nunca" })
    const eff = effectiveTablePreset(base, base.phases, base.maxCostUsd)
    expect(eff.name).toBe("Feature completa")
    expect(eff.gatePolicy).toBe("nunca")
  })
})

describe("launchFromTable — política chega ao launch", () => {
  it("gatePolicy do rascunho viaja no preset efetivo", async () => {
    const launch = vi.fn(
      async (_args: {
        projectId: string
        title: string
        task: string
        preset: MissionPreset
      }) => "conv-nova",
    )
    const base = presetOf()
    await launchFromTable(
      { launch },
      {
        projectId: "p1",
        task: "arruma o parser",
        preset: base,
        phases: base.phases,
        capUsd: base.maxCostUsd,
        gatePolicy: "nunca",
      },
    )
    const args = launch.mock.calls[0][0]
    expect(args.preset.gatePolicy).toBe("nunca")
    expect(args.preset.name).toBe("Feature completa · personalizado")
  })
})
