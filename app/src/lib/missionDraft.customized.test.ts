// Ressalva do gate MH3+MH4 — régua ÚNICA do "está personalizado?"
// (draftCustomized): o TETO entra na conta junto de fases e política. Antes o
// Dock usava só phasesCustomized+gatePolicyCustomized e editar SÓ o teto lá
// não oferecia "salvar como time" nem marcava "time personalizado" (o
// Launcher do Linear já contava o cap). Launcher e Dock agora consomem este
// helper — divergência de régua morre na fonte.

import { describe, expect, it } from "vitest"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import { clonePhases, draftCustomized, editPhase } from "./missionDraft"

function phaseDef(over: Partial<MissionPhaseDef> = {}): MissionPhaseDef {
  return {
    id: "p",
    label: "Fase",
    persona: "executor",
    agent: "claude-code",
    model: null,
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
    phases: [phaseDef(), phaseDef({ id: "review", persona: "reviewer" })],
    ...over,
  }
}

describe("draftCustomized — o teto entra na régua (caso do Dock)", () => {
  it("rascunho idêntico ao preset (fases, política e teto) → NÃO personalizado", () => {
    const preset = presetOf()
    expect(
      draftCustomized({
        preset,
        phases: clonePhases(preset.phases),
        gatePolicy: preset.gatePolicy,
        capUsd: preset.maxCostUsd,
      }),
    ).toBe(false)
  })

  it("editar SÓ o teto → personalizado (o furo do Dock: salvar como time passa a ser oferecido)", () => {
    const preset = presetOf({ maxCostUsd: 25 })
    expect(
      draftCustomized({
        preset,
        phases: clonePhases(preset.phases),
        gatePolicy: preset.gatePolicy,
        capUsd: 10,
      }),
    ).toBe(true)
  })

  it("remover o teto (null) de um preset com teto → personalizado; null vs null → não", () => {
    const comTeto = presetOf({ maxCostUsd: 25 })
    expect(
      draftCustomized({
        preset: comTeto,
        phases: clonePhases(comTeto.phases),
        gatePolicy: comTeto.gatePolicy,
        capUsd: null,
      }),
    ).toBe(true)
    const semTeto = presetOf({ maxCostUsd: null })
    expect(
      draftCustomized({
        preset: semTeto,
        phases: clonePhases(semTeto.phases),
        gatePolicy: semTeto.gatePolicy,
        capUsd: null,
      }),
    ).toBe(false)
  })

  it("fase editada → personalizado (a régua antiga continua valendo)", () => {
    const preset = presetOf()
    expect(
      draftCustomized({
        preset,
        phases: editPhase(clonePhases(preset.phases), 0, { agent: "codex" }),
        gatePolicy: preset.gatePolicy,
        capUsd: preset.maxCostUsd,
      }),
    ).toBe(true)
  })

  it("política editada → personalizado; ausente nos dois lados normaliza pra 'agente' (não personalizado)", () => {
    const preset = presetOf() // sem gatePolicy = "agente"
    expect(
      draftCustomized({
        preset,
        phases: clonePhases(preset.phases),
        gatePolicy: "nunca",
        capUsd: preset.maxCostUsd,
      }),
    ).toBe(true)
    expect(
      draftCustomized({
        preset,
        phases: clonePhases(preset.phases),
        gatePolicy: "agente",
        capUsd: preset.maxCostUsd,
      }),
    ).toBe(false)
  })
})
