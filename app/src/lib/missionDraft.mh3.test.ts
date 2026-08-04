// MH3 — lógica pura NOVA do rascunho: salvar como time (MH3.1), política de
// gate no dirty/customizado (MH3.3) e o acoplamento Autonomia↔gate (o toggle
// do time liga "nunca"; desligar volta pra política do preset).
import { describe, expect, it } from "vitest"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import {
  GATE_POLICY_OPTIONS,
  SAVE_PRESET_ERROR_COPY,
  gatePolicyCustomized,
  normalizeGatePolicy,
  saveDraftAsPreset,
  teamAutonomy,
  toggleTeamAutonomyWithGate,
  validatePresetName,
} from "./missionDraft"

function phase(over: Partial<MissionPhaseDef> = {}): MissionPhaseDef {
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

function preset(over: Partial<MissionPreset> = {}): MissionPreset {
  return {
    id: "feature",
    name: "Feature completa",
    maxCostUsd: 25,
    phases: [phase(), phase({ id: "build", persona: "executor", agent: "codex", model: null })],
    ...over,
  }
}

describe("gatePolicyCustomized (política editada = rascunho custom)", () => {
  it("ausente no preset = 'agente' (fail-open): rascunho 'agente' NÃO é custom", () => {
    expect(gatePolicyCustomized(undefined, "agente")).toBe(false)
    expect(gatePolicyCustomized("agente", undefined)).toBe(false)
    expect(gatePolicyCustomized(undefined, undefined)).toBe(false)
  })

  it("política diferente da do preset é custom (e voltar deixa de ser)", () => {
    expect(gatePolicyCustomized(undefined, "nunca")).toBe(true)
    expect(gatePolicyCustomized("nunca", "agente")).toBe(true)
    expect(gatePolicyCustomized("nunca", "nunca")).toBe(false)
    expect(gatePolicyCustomized("sempre-apos-planejar", "sempre-apos-planejar")).toBe(false)
  })

  it("normalizeGatePolicy: ausente vira 'agente'", () => {
    expect(normalizeGatePolicy(undefined)).toBe("agente")
    expect(normalizeGatePolicy(null)).toBe("agente")
    expect(normalizeGatePolicy("nunca")).toBe("nunca")
  })
})

describe("toggleTeamAutonomyWithGate (Autonomia↔gate, MH3.3)", () => {
  const base = [phase(), phase({ id: "build", persona: "executor" })]

  it("LIGAR põe o time todo em auto E a política em 'nunca' (autonomia total)", () => {
    const next = toggleTeamAutonomyWithGate({
      phases: base,
      gatePolicy: "agente",
      presetGatePolicy: "agente",
    })
    expect(teamAutonomy(next.phases)).toBe("auto")
    expect(next.gatePolicy).toBe("nunca")
  })

  it("time MISTO conta como desligado: ligar resolve pra auto-todos + 'nunca'", () => {
    const mixed = [phase({ autonomy: "auto" }), phase({ id: "build" })]
    const next = toggleTeamAutonomyWithGate({
      phases: mixed,
      gatePolicy: "agente",
      presetGatePolicy: undefined,
    })
    expect(teamAutonomy(next.phases)).toBe("auto")
    expect(next.gatePolicy).toBe("nunca")
  })

  it("DESLIGAR volta o time a herdar e a política pra do preset", () => {
    const on = toggleTeamAutonomyWithGate({
      phases: base,
      gatePolicy: "sempre-apos-planejar",
      presetGatePolicy: "sempre-apos-planejar",
    })
    const off = toggleTeamAutonomyWithGate({
      phases: on.phases,
      gatePolicy: on.gatePolicy,
      presetGatePolicy: "sempre-apos-planejar",
    })
    expect(teamAutonomy(off.phases)).toBe("inherit")
    expect(off.gatePolicy).toBe("sempre-apos-planejar")
  })

  it("preset sem política: desligar volta pro default 'agente'", () => {
    const on = toggleTeamAutonomyWithGate({
      phases: base,
      gatePolicy: "agente",
      presetGatePolicy: undefined,
    })
    const off = toggleTeamAutonomyWithGate({
      phases: on.phases,
      gatePolicy: on.gatePolicy,
      presetGatePolicy: undefined,
    })
    expect(off.gatePolicy).toBe("agente")
  })
})

describe("validatePresetName (MH3.1 — erro honesto inline)", () => {
  const existing = [preset(), preset({ id: "barato", name: "Econômico" })]

  it("vazio (ou só espaços) → 'vazio'", () => {
    expect(validatePresetName("", existing)).toBe("vazio")
    expect(validatePresetName("   ", existing)).toBe("vazio")
  })

  it("duplicado é case-insensitive e ignora espaços das pontas", () => {
    expect(validatePresetName("Feature completa", existing)).toBe("duplicado")
    expect(validatePresetName("feature COMPLETA", existing)).toBe("duplicado")
    expect(validatePresetName("  Econômico  ", existing)).toBe("duplicado")
  })

  it("nome novo passa (null)", () => {
    expect(validatePresetName("Meu time", existing)).toBeNull()
  })

  it("a copy dos erros existe e não usa travessão", () => {
    for (const err of ["vazio", "duplicado"] as const) {
      expect(SAVE_PRESET_ERROR_COPY[err]).toBeTruthy()
      expect(SAVE_PRESET_ERROR_COPY[err]).not.toContain("—")
    }
  })
})

describe("saveDraftAsPreset (MH3.1 — salvar o rascunho como time)", () => {
  const existing = [preset()]
  const draft = [
    phase({ model: "sonnet", autonomy: "auto" }),
    phase({ id: "build", persona: "executor", agent: "agy", model: null }),
  ]

  it("persiste: lista ganha o preset novo (fases CLONADAS + teto + política) e o id aponta pra ele", () => {
    const res = saveDraftAsPreset({
      name: "Time turbo",
      presets: existing,
      phases: draft,
      maxCostUsd: 12.5,
      gatePolicy: "nunca",
      id: "preset-test1",
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.presets).toHaveLength(2)
    expect(res.presets[1]).toBe(res.preset) // o seletor aponta pro salvo
    expect(res.preset.id).toBe("preset-test1")
    expect(res.preset.name).toBe("Time turbo")
    expect(res.preset.phases).toEqual(draft)
    expect(res.preset.phases[0]).not.toBe(draft[0]) // clone, nunca o rascunho
    expect(res.preset.maxCostUsd).toBe(12.5)
    expect(res.preset.gatePolicy).toBe("nunca")
    expect(existing).toHaveLength(1) // lista original intacta (imutável)
  })

  it("id gerado quando não injetado; nome salvo sem espaços das pontas", () => {
    const res = saveDraftAsPreset({
      name: "  Time novo  ",
      presets: existing,
      phases: draft,
      maxCostUsd: null,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.preset.id).toMatch(/^preset-/)
    expect(res.preset.name).toBe("Time novo")
    expect(res.preset.gatePolicy).toBe("agente") // default normalizado
  })

  it("nome duplicado (case-insensitive) NÃO salva → erro 'duplicado'", () => {
    const res = saveDraftAsPreset({
      name: "FEATURE COMPLETA",
      presets: existing,
      phases: draft,
      maxCostUsd: null,
    })
    expect(res).toEqual({ ok: false, error: "duplicado" })
  })

  it("nome vazio NÃO salva → erro 'vazio'", () => {
    const res = saveDraftAsPreset({
      name: "  ",
      presets: existing,
      phases: draft,
      maxCostUsd: null,
    })
    expect(res).toEqual({ ok: false, error: "vazio" })
  })
})

describe("GATE_POLICY_OPTIONS (copy do seletor)", () => {
  it("cobre as 3 políticas, em pt-BR sem travessão", () => {
    expect(GATE_POLICY_OPTIONS.map((o) => o.value)).toEqual([
      "agente",
      "sempre-apos-planejar",
      "nunca",
    ])
    for (const o of GATE_POLICY_OPTIONS) {
      expect(o.label).not.toContain("—")
      expect(o.description).not.toContain("—")
    }
  })
})
