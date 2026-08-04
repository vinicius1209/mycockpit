// MH1.2 — missão é run DESASSISTIDO por FASE: cada fase roda com o runId
// marcado em lib/unattendedRuns (padrão scheduleEngine.ts), pra que um pedido
// de permissão/pergunta sem resposta expire FAIL-CLOSED no vigia (ADR-021) em
// vez de congelar a fase pra sempre (o backend espera sem timeout). O clear no
// finally é o cancelamento do timer: fase que termina (ok, falha OU pausa em
// recovery) não deixa marca pendurada.
//
// Modelado no mission.recovery.test.ts: só runPhase é mocado; o registro de
// unattendedRuns é o REAL (módulo com Map, resetado no beforeEach).

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import type { ChatItem } from "@/store/chat"

const h = vi.hoisted(() => ({
  results: [] as PhaseResult[],
  // o que o runPhase VIU no momento da execução: runId + se estava marcado.
  seen: [] as { runId: string; marked: boolean }[],
}))

vi.mock("@/lib/mission", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/mission")>()
  return {
    ...mod,
    runPhase: vi.fn(async (args: import("@/lib/mission").RunPhaseArgs) => {
      const { isUnattendedRun } = await import("@/lib/unattendedRuns")
      h.seen.push({ runId: args.runId, marked: isUnattendedRun(args.runId) })
      return (
        h.results.shift() ?? {
          ok: true,
          items: [],
          costUsd: 0,
          costSource: undefined,
        }
      )
    }),
  }
})

vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, cancelAgent: vi.fn(async () => {}) }
})

import { useMission } from "./mission"
import {
  _resetUnattendedRuns,
  unattendedConvOf,
  unattendedRunIds,
} from "@/lib/unattendedRuns"

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

function preset(phases: MissionPhaseDef[]): MissionPreset {
  return { id: "t", name: "Teste", phases, maxCostUsd: null }
}

function ok(costUsd = 0): PhaseResult {
  return { ok: true, items: [], costUsd, costSource: undefined }
}

/** Falha RECUPERÁVEL via item kind:"limit" (pausa em recovery). */
function limitFail(costUsd = 0): PhaseResult {
  const item: ChatItem = { kind: "limit", id: "l1", message: "limite da CLI" }
  return {
    ok: false,
    items: [item],
    costUsd,
    costSource: undefined,
    error: "limit_reached",
  }
}

const CONV = "c1"

function launch(pre: MissionPreset): Promise<void> {
  return useMission
    .getState()
    .launch(CONV, pre, "tarefa", "proj1", "/tmp/proj", "padrao")
}

function run() {
  return useMission.getState().byConv[CONV]
}

async function waitFor(cond: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 0))
  }
  throw new Error("condição não satisfeita a tempo")
}

beforeEach(() => {
  h.results = []
  h.seen = []
  _resetUnattendedRuns()
  useMission.setState({ byConv: {} })
})

describe("MH1.2 · fases de missão são runs desassistidos (fail-closed possível)", () => {
  it("CADA fase roda MARCADA (runId por fase, conversa registrada pro aviso)", async () => {
    h.results = [ok(0.1), ok(0.2)]
    await launch(preset([phaseDef(), phaseDef({ id: "p2" })]))

    expect(h.seen).toHaveLength(2)
    expect(h.seen[0].marked).toBe(true)
    expect(h.seen[1].marked).toBe(true)
    // runId estável por fase: `${missionId}::phase-N` (o ownerByRunId resolve)
    const missionId = run().id
    expect(h.seen[0].runId).toBe(`${missionId}::phase-0`)
    expect(h.seen[1].runId).toBe(`${missionId}::phase-1`)
  })

  it("fim da missão não deixa marca pendurada (o clear é o cancelamento do timer)", async () => {
    h.results = [ok(0.1)]
    await launch(preset([phaseDef()]))

    expect(run().status).toBe("done")
    expect(unattendedRunIds().size).toBe(0)
  })

  it("pausa em RECOVERY desmarca: esperando humano não é run desassistido rodando", async () => {
    h.results = [limitFail(0.2)]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })]))

    await waitFor(() => !!run()?.recovery)
    // a fase parou (runPhase resolveu) → nada marcado enquanto o card espera
    expect(unattendedRunIds().size).toBe(0)

    useMission.getState().abortRecovery(CONV)
    await p
    expect(unattendedRunIds().size).toBe(0)
  })

  it("re-run após recovery re-marca a MESMA fase (o gasto novo também é vigiado)", async () => {
    h.results = [limitFail(0.2), ok(0.3), ok(0.1)]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })]))

    await waitFor(() => !!run()?.recovery)
    useMission
      .getState()
      .resolveRecovery(CONV, { agent: "codex", model: null, effort: null })
    await waitFor(() => run()?.status === "done")
    await p

    // 3 execuções (fase 0 duas vezes + fase 1), todas marcadas na hora
    expect(h.seen.map((s) => s.marked)).toEqual([true, true, true])
    const missionId = run().id
    expect(h.seen[1].runId).toBe(`${missionId}::phase-0`)
    expect(unattendedRunIds().size).toBe(0)
  })

  it("a marca registra a CONVERSA da missão (fallback do aviso do vigia)", async () => {
    let convDuring: string | null = null
    h.results = []
    const { runPhase } = await import("@/lib/mission")
    ;(runPhase as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (args: import("@/lib/mission").RunPhaseArgs) => {
        convDuring = unattendedConvOf(args.runId)
        return { ok: true, items: [], costUsd: 0, costSource: undefined }
      },
    )
    await launch(preset([phaseDef()]))
    expect(convDuring).toBe(CONV)
  })
})
