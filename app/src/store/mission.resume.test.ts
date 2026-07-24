// Missão sobrevive a restart (P1 confiabilidade): o pipeline persiste um
// snapshot em .mission/run-state.json no worktree a cada MARCO; no boot, uma
// conversa cujo arquivo ficou `running` SEM run em memória ganha a oferta de
// RETOMADA (retomar re-roda da fase corrente com os custos anteriores somados;
// descartar marca abandoned e não re-oferece). Modelado no
// mission.recovery.test.ts: runPhase mocado + FS fake em memória (Map por cwd);
// os helpers puros (parseRunState, runToState, shouldOfferResume…) seguem reais.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type {
  MissionPhaseDef,
  MissionPreset,
  MissionRun,
} from "@/lib/missionTypes"
import type { MissionRunState } from "@/lib/missionState"

// Estado compartilhado com as fábricas de mock (hoisted p/ o vi.mock enxergar).
const h = vi.hoisted(() => ({
  results: [] as PhaseResult[],
  calls: [] as { agent: string; prompt: string }[],
  /** FS fake: cwd → run-state.json serializado. */
  disk: new Map<string, string>(),
}))

vi.mock("@/lib/mission", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/mission")>()
  return {
    ...mod,
    runPhase: vi.fn(async (args: import("@/lib/mission").RunPhaseArgs) => {
      h.calls.push({ agent: args.agent, prompt: args.prompt })
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

// FS fake do run-state (fora do Tauri o invoke real só falharia): a escrita
// serializa pro Map, a leitura re-parseia com o parser REAL — o round-trip
// completo (runToState → JSON → parseRunState) é exercitado de verdade.
vi.mock("@/lib/missionState", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/missionState")>()
  return {
    ...mod,
    writeRunState: vi.fn(async (cwd: string, state: MissionRunState) => {
      h.disk.set(cwd, JSON.stringify(state))
    }),
    readRunState: vi.fn(async (cwd: string) => {
      const raw = h.disk.get(cwd)
      return raw ? mod.parseRunState(raw) : null
    }),
    // ponteiro conv→dir é no-op no fake (uma missão por cwd no teste); a
    // detecção lê o mesmo disco por cwd, exercitando o round-trip real.
    writeActivePointer: vi.fn(async () => {}),
    readInterruptedFor: vi.fn(async (cwd: string) => {
      const raw = h.disk.get(cwd)
      return raw ? mod.parseRunState(raw) : null
    }),
  }
})

import { useMission } from "./mission"
import { parseRunState, writeRunState } from "@/lib/missionState"

// ── Factories locais ──────────────────────────────────────────────────────

const CONV = "c1"
const CWD = "/tmp/proj" // launch: cwd = worktreePath ?? projectPath (byId vazio)

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

function preset(
  phases: MissionPhaseDef[],
  maxCostUsd: number | null = null,
): MissionPreset {
  return { id: "t", name: "Teste", phases, maxCostUsd }
}

function ok(costUsd = 0): PhaseResult {
  return { ok: true, items: [], costUsd, costSource: undefined }
}

/** run-state de missão interrompida na fase 2/2 (fase 1 done, US$ 0.40). */
function seededState(over: Partial<MissionRunState> = {}): MissionRunState {
  const phases = [
    phaseDef({ id: "plan", label: "Planejar", persona: "planner" }),
    phaseDef({ id: "build", label: "Executar" }),
  ]
  return {
    version: 1,
    missionId: "m-interrompida",
    dir: ".mycockpit/missions/m-interrompida",
    convId: CONV,
    task: "tarefa retomada",
    preset: { id: "t", name: "Teste", phases, maxCostUsd: null },
    current: 1,
    phases: [
      { status: "done", costUsd: 0.4 },
      { status: "running", costUsd: 0 },
    ],
    costTotal: 0.4,
    maxCostUsd: null,
    gateDecisions: null,
    status: "running",
    updatedAt: 123,
    ...over,
  }
}

function seed(state: MissionRunState = seededState()) {
  h.disk.set(CWD, JSON.stringify(state))
}

function diskState(): MissionRunState | null {
  const raw = h.disk.get(CWD)
  return raw ? parseRunState(raw) : null
}

function launch(pre: MissionPreset): Promise<void> {
  return useMission
    .getState()
    .launch(CONV, pre, "tarefa", "proj1", CWD, "padrao")
}

function run() {
  return useMission.getState().byConv[CONV]
}

function interrupted() {
  return useMission.getState().interrupted[CONV]
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
  h.calls = []
  h.disk.clear()
  vi.mocked(writeRunState).mockClear()
  useMission.setState({ byConv: {}, interrupted: {} })
})

describe("persistência do pipeline nos marcos (run-state.json no worktree)", () => {
  it("grava nos marcos (início running → fim done) com custos e preset efetivo", async () => {
    h.results = [ok(0.2), ok(0.3)]
    await launch(preset([phaseDef({ id: "a" }), phaseDef({ id: "b" })]))

    // marcos: início + (start+done por fase) + fim ⇒ várias escritas.
    const writes = vi.mocked(writeRunState).mock.calls
    expect(writes.length).toBeGreaterThanOrEqual(4)
    // 1º marco: o início ainda está running, na fase 0, custo zero.
    expect(writes[0][0]).toBe(CWD)
    expect(writes[0][1].status).toBe("running")
    expect(writes[0][1].current).toBe(0)

    // estado final no disco: fim normal marca done (terminal — não re-oferece).
    const st = diskState()
    expect(st).not.toBeNull()
    expect(st!.version).toBe(1)
    expect(st!.convId).toBe(CONV)
    expect(st!.status).toBe("done")
    expect(st!.costTotal).toBeCloseTo(0.5, 5)
    expect(st!.phases.map((p) => p.status)).toEqual(["done", "done"])
    expect(st!.preset.phases).toHaveLength(2)
  })

  it("fim normal limpa: arquivo done não re-oferece retomada no boot", async () => {
    h.results = [ok(0.1)]
    await launch(preset([phaseDef()]))
    expect(diskState()?.status).toBe("done")

    // simula o restart: o run em memória some, o arquivo fica.
    useMission.setState({ byConv: {} })
    await useMission.getState().detectInterrupted(CONV, CWD)
    expect(interrupted()).toBeUndefined()
  })
})

describe("detecção no boot (card de retomada)", () => {
  it("arquivo running sem missão em memória ⇒ oferece retomada", async () => {
    seed()
    await useMission.getState().detectInterrupted(CONV, CWD)
    const entry = interrupted()
    expect(entry).toBeDefined()
    expect(entry.cwd).toBe(CWD)
    expect(entry.state.current).toBe(1)
    expect(entry.state.task).toBe("tarefa retomada")
    expect(entry.state.preset.phases).toHaveLength(2)
  })

  it("missão em memória (qualquer status) ⇒ não oferece", async () => {
    seed()
    const dummy: MissionRun = {
      id: "x",
      convId: CONV,
      presetName: "t",
      dir: ".mycockpit/missions/x",
      task: "t",
      phases: [],
      current: 0,
      costTotal: 0,
      maxCostUsd: null,
      status: "done",
      startedAt: 0,
    }
    useMission.setState({ byConv: { [CONV]: dummy } })
    await useMission.getState().detectInterrupted(CONV, CWD)
    expect(interrupted()).toBeUndefined()
  })

  it("arquivo de OUTRA conversa (cwd compartilhado sem worktree) ⇒ não oferece", async () => {
    seed(seededState({ convId: "outra-conversa" }))
    await useMission.getState().detectInterrupted(CONV, CWD)
    expect(interrupted()).toBeUndefined()
  })

  it("arquivo sumiu/terminal ⇒ limpa uma oferta anterior", async () => {
    seed()
    await useMission.getState().detectInterrupted(CONV, CWD)
    expect(interrupted()).toBeDefined()
    h.disk.clear()
    await useMission.getState().detectInterrupted(CONV, CWD)
    expect(interrupted()).toBeUndefined()
  })
})

describe("retomada (re-roda da fase corrente, custos anteriores somados)", () => {
  it("re-roda SÓ a fase corrente; fases feitas entram como done com o custo do arquivo", async () => {
    seed()
    await useMission.getState().detectInterrupted(CONV, CWD)
    h.results = [ok(0.6)]
    useMission.getState().resumeInterrupted(CONV, "proj1", CWD, "padrao")

    await waitFor(() => run()?.status === "done")
    // só a fase corrente (índice 1) re-rodou — a 0 não gastou de novo.
    expect(h.calls).toHaveLength(1)
    expect(run().phases[0].status).toBe("done")
    expect(run().phases[0].costUsd).toBeCloseTo(0.4, 5)
    expect(run().phases[1].status).toBe("done")
    // costTotal retomado soma: 0.4 (arquivo) + 0.6 (re-run).
    expect(run().costTotal).toBeCloseTo(1.0, 5)
    // a oferta foi consumida e o arquivo terminou done.
    expect(interrupted()).toBeUndefined()
    await waitFor(() => diskState()?.status === "done")
  })

  it("costTotal retomado soma ao TETO: orçamento estourado barra antes de gastar", async () => {
    seed(seededState({ costTotal: 1.5, maxCostUsd: 1.0 }))
    await useMission.getState().detectInterrupted(CONV, CWD)
    useMission.getState().resumeInterrupted(CONV, "proj1", CWD, "padrao")

    await waitFor(() => run()?.status === "error")
    expect(h.calls).toHaveLength(0) // o checkBudget barrou antes do runPhase
    expect(run().costTotal).toBeCloseTo(1.5, 5)
  })

  it("gate respondido com a fase do gate JÁ done: NÃO re-paga a fase — avança e injeta as decisões na PRÓXIMA", async () => {
    // Estado real do marco "gate respondido": current AINDA na fase do gate
    // (o i++ vem depois do persist), fase done, decisões destinadas à seguinte.
    seed(
      seededState({
        current: 0,
        phases: [
          { status: "done", costUsd: 0.4 },
          { status: "queued", costUsd: 0 },
        ],
        gateDecisions:
          "## Decisões do usuário (gate humano)\n1. P: qual lib?\n   R: usar zod",
      }),
    )
    await useMission.getState().detectInterrupted(CONV, CWD)
    h.results = [ok(0.2)]
    useMission.getState().resumeInterrupted(CONV, "proj1", CWD, "padrao")

    await waitFor(() => run()?.status === "done")
    // SÓ a fase 1 rodou — a fase 0 (concluída e paga) não gastou de novo.
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].prompt).toContain("usar zod")
    expect(run().phases[0].status).toBe("done")
    expect(run().phases[0].costUsd).toBeCloseTo(0.4, 5)
    expect(run().costTotal).toBeCloseTo(0.6, 5)
  })

  it("gate RESPONDIDO antes do crash sobrevive: decisões reinjetadas no prompt", async () => {
    seed(
      seededState({
        gateDecisions:
          "## Decisões do usuário (gate humano)\n1. P: qual lib?\n   R: usar zod",
      }),
    )
    await useMission.getState().detectInterrupted(CONV, CWD)
    h.results = [ok(0.1)]
    useMission.getState().resumeInterrupted(CONV, "proj1", CWD, "padrao")

    await waitFor(() => run()?.status === "done")
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].prompt).toContain("usar zod")
  })
})

describe("descartar", () => {
  it("marca o arquivo como abandoned e NÃO re-oferece no próximo boot", async () => {
    seed()
    await useMission.getState().detectInterrupted(CONV, CWD)
    expect(interrupted()).toBeDefined()

    await useMission.getState().discardInterrupted(CONV)
    expect(interrupted()).toBeUndefined()
    expect(diskState()?.status).toBe("abandoned")

    // re-boot: abandoned é terminal, a oferta não volta.
    await useMission.getState().detectInterrupted(CONV, CWD)
    expect(interrupted()).toBeUndefined()
  })
})
