// Recuperação de missão (onda 2): quando uma fase falha por LIMITE (não por
// bug), a missão PAUSA em recovery em vez de morrer — espelha o gate humano. O
// usuário troca o agent/modelo (resolveRecovery → re-roda a MESMA fase) ou
// desiste (abortRecovery → error). O custo de TODAS as tentativas é real e
// acumula. Modelado no estilo do mission.gate.test.ts (factories locais, PT).
//
// Só o runPhase (que dispara o agent real) é mocado; os helpers puros de
// @/lib/mission (isRecoverableFailure, recoveryMessage, checkBudget…) seguem
// reais. As libs de DB/FS/git degradam sozinhas fora do Tauri (nulls).

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type {
  MissionPhaseDef,
  MissionPreset,
  RecoveryChoice,
} from "@/lib/missionTypes"
import type { ChatItem } from "@/store/chat"

// Estado compartilhado com a fábrica de mock (hoisted p/ o vi.mock enxergar).
const h = vi.hoisted(() => ({
  results: [] as PhaseResult[],
  calls: [] as { agent: string; model: string | null; effort: string | null }[],
}))

vi.mock("@/lib/mission", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/mission")>()
  return {
    ...mod,
    runPhase: vi.fn(async (args: import("@/lib/mission").RunPhaseArgs) => {
      h.calls.push({ agent: args.agent, model: args.model, effort: args.effort })
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

// abort() cancela o run da fase corrente (invoke Tauri) — mocado p/ não vazar.
vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, cancelAgent: vi.fn(async () => {}) }
})

import { useMission } from "./mission"

// ── Factories locais ──────────────────────────────────────────────────────

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

function preset(phases: MissionPhaseDef[], maxCostUsd: number | null = null): MissionPreset {
  return { id: "t", name: "Teste", phases, maxCostUsd }
}

function ok(costUsd = 0, items: ChatItem[] = []): PhaseResult {
  return { ok: true, items, costUsd, costSource: undefined }
}

/** Falha RECUPERÁVEL via item kind:"limit" no transcript. */
function limitFail(costUsd = 0): PhaseResult {
  const item: ChatItem = { kind: "limit", id: "l1", message: "limite da CLI" }
  return { ok: false, items: [item], costUsd, costSource: undefined, error: "limit_reached" }
}

/** Falha RECUPERÁVEL via heurística de texto (rate limit) no error. */
function rateFail(costUsd = 0): PhaseResult {
  return { ok: false, items: [], costUsd, costSource: undefined, error: "rate limit atingido, tente de novo" }
}

/** Falha NÃO-recuperável (bug comum). */
function bugFail(costUsd = 0): PhaseResult {
  return { ok: false, items: [], costUsd, costSource: undefined, error: "erro de compilação no arquivo x" }
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

const codex: RecoveryChoice = { agent: "codex", model: "gpt-5.5", effort: "high" }

beforeEach(() => {
  h.results = []
  h.calls = []
  useMission.setState({ byConv: {} })
})

describe("recuperação de missão (falha por limite pausa em vez de matar)", () => {
  it("falha recuperável → PAUSA em recovery (status segue running, não error)", async () => {
    h.results = [limitFail(0.5)]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })]))

    await waitFor(() => !!run()?.recovery)
    const r = run()
    expect(r.status).toBe("running") // pausado, NÃO morto
    expect(r.recovery).toEqual({
      phase: 0,
      error: "limit_reached",
      message: expect.stringContaining("Escolha outro agent"),
    })

    // encerra o teste sem promessa pendurada.
    useMission.getState().abortRecovery(CONV)
    await p
  })

  it("também pausa quando a falha é só heurística de texto (rate limit) no error", async () => {
    h.results = [rateFail(0.1)]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })]))
    await waitFor(() => !!run()?.recovery)
    expect(run().recovery?.phase).toBe(0)
    useMission.getState().abortRecovery(CONV)
    await p
  })

  it("resolveRecovery com outro agent → re-roda a MESMA fase com o agent novo e a missão continua", async () => {
    h.results = [limitFail(0.5), ok(0.7), ok(0.3)] // fail → rerun ok → fase 2 ok
    const p = launch(preset([phaseDef({ agent: "claude-code" }), phaseDef({ id: "p2" })]))

    await waitFor(() => !!run()?.recovery)
    expect(h.calls[0].agent).toBe("claude-code") // 1ª tentativa: agent do preset

    useMission.getState().resolveRecovery(CONV, codex)
    await waitFor(() => run()?.status === "done")
    await p

    // 2ª tentativa da fase 0 usou o agent NOVO; índice não avançou (re-rodou i=0).
    expect(h.calls[1]).toEqual({ agent: "codex", model: "gpt-5.5", effort: "high" })
    expect(run().phases[0].def.agent).toBe("codex")
    expect(run().phases[0].def.model).toBe("gpt-5.5")
    expect(run().recovery).toBeNull()
    expect(run().status).toBe("done")
  })

  it("abortRecovery (desistir) → a missão vai a error e limpa o recovery", async () => {
    h.results = [limitFail(0.4)]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })]))

    await waitFor(() => !!run()?.recovery)
    useMission.getState().abortRecovery(CONV)
    await p

    expect(run().status).toBe("error")
    expect(run().recovery).toBeNull()
  })

  it("custo é REAL: acumula as duas tentativas (falha + rerun) + fases seguintes", async () => {
    h.results = [limitFail(0.5), ok(0.7), ok(0.3)]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })]))

    await waitFor(() => !!run()?.recovery)
    useMission.getState().resolveRecovery(CONV, codex)
    await waitFor(() => run()?.status === "done")
    await p

    expect(run().costTotal).toBeCloseTo(1.5, 5) // 0.5 + 0.7 + 0.3
    expect(run().phases[0].costUsd).toBeCloseTo(1.2, 5) // as duas tentativas da fase
  })

  it("abort() durante a recuperação libera o waiter (missão vai a aborted, sem travar)", async () => {
    h.results = [limitFail(0.2)]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })]))

    await waitFor(() => !!run()?.recovery)
    useMission.getState().abort(CONV)
    await p // resolve só se o waiter foi liberado

    expect(run().status).toBe("aborted")
    expect(run().recovery).toBeNull()
  })

  it("falha NÃO-recuperável (bug) segue matando a missão (comportamento herdado)", async () => {
    h.results = [bugFail(0.6)]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })]))
    await p

    expect(run().status).toBe("error")
    expect(run().recovery ?? null).toBeNull()
    expect(run().phases[0].status).toBe("error")
    expect(h.calls).toHaveLength(1) // não re-rodou
  })

  it("teto HARD é re-checado ANTES do re-run: recuperação já estourada não gasta de novo", async () => {
    // 1ª tentativa gasta US$ 1.2 (> teto 1.0) e bate limite → pausa em recovery.
    // Ao resolver, o re-check de orçamento deve RECUSAR o re-run (custo já
    // estourou) e a missão vai a error SEM uma 2ª chamada ao runPhase.
    h.results = [limitFail(1.2), ok(0.7)]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })], 1.0))

    await waitFor(() => !!run()?.recovery)
    useMission.getState().resolveRecovery(CONV, codex)
    await p

    expect(run().status).toBe("error")
    expect(run().recovery ?? null).toBeNull()
    expect(h.calls).toHaveLength(1) // NÃO re-rodou (teto barrou)
    expect(run().costTotal).toBeCloseTo(1.2, 5) // só a 1ª tentativa
    expect(run().phases[0].error).toContain("orçamento")
  })
})
