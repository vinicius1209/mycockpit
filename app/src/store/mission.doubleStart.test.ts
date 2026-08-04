// Ressalva do gate MH3+MH4 — JANELA de duplo-start no launch: a guarda
// anti-duplo-start lia byConv no topo, mas o run só entrava no estado DEPOIS
// do IO de preparação (ensureMissionCwd/doutrina) — dois cliques em
// "Retomar"/"Lançar" antes do primeiro await resolver passavam AMBOS pela
// guarda e pagavam fases em dobro com o MESMO missionId. A correção semeia o
// run em byConv sincronamente (antes de qualquer await) e tira o card de
// retomada no mesmo instante; falha de preparação limpa a semente e devolve o
// card (nunca um "rodando" falso).
//
// Modelado no mission.worktree.test.ts (ensureMissionCwd mocado) — aqui o
// mock é LENTO de propósito (promise controlada pelo teste) pra provar a
// janela de IO de verdade, não só a guarda com missão já rodando.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type { EnsureMissionCwdResult } from "@/lib/missionWorktree"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import type { MissionRunState } from "@/lib/missionState"
import type { ChatItem, ConvState } from "./chat"

const h = vi.hoisted(() => ({
  results: [] as PhaseResult[],
  runCalls: 0,
  /** Resolvedores pendentes do ensure lento (um por launch que chegou lá). */
  ensureWaiters: [] as ((r: EnsureMissionCwdResult) => void)[],
}))

vi.mock("@/lib/mission", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/mission")>()
  return {
    ...mod,
    runPhase: vi.fn(async () => {
      h.runCalls++
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

// ensure LENTO: cada chamada fica pendurada até o teste resolver — é a janela
// de IO real do launch (worktree sendo criado) em câmera lenta.
vi.mock("@/lib/missionWorktree", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/missionWorktree")>()
  return {
    ...mod,
    ensureMissionCwd: vi.fn(
      () =>
        new Promise<EnsureMissionCwdResult>((resolve) => {
          h.ensureWaiters.push(resolve)
        }),
    ),
  }
})

vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, cancelAgent: vi.fn(async () => {}) }
})

import { useMission } from "./mission"
import { useChat } from "./chat"

const CONV = "c1"
const PROJ = "proj1"
const CWD = "/tmp/proj"

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

const PRESET: MissionPreset = {
  id: "t",
  name: "Teste",
  phases: [phaseDef({ id: "build", label: "Executar" })],
  maxCostUsd: null,
}

function seedConv() {
  const conv: ConvState = {
    projectId: PROJ,
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [],
    sessionId: null,
    model: null,
    streamingTextId: null,
    running: false,
    finalizing: false,
    runId: null,
    startedAt: null,
    suggestions: [],
    suggesting: false,
  }
  useChat.setState({
    projectId: PROJ,
    activeId: CONV,
    conversations: [],
    conversationsByProject: {
      [PROJ]: [
        {
          id: CONV,
          title: "Missão · Teste",
          updatedAt: 0,
          color: null,
          worktreePath: null,
          agent: "claude-code",
        },
      ],
    },
    byId: { [CONV]: conv },
  })
}

function launch(): Promise<void> {
  return useMission
    .getState()
    .launch(CONV, PRESET, "tarefa", PROJ, CWD, "padrao")
}

/** Destrava os ensures pendentes (ok na pasta do projeto, sem worktree). */
function releaseEnsures(over: Partial<EnsureMissionCwdResult> = {}) {
  for (const resolve of h.ensureWaiters.splice(0)) {
    resolve({ ok: true, cwd: CWD, created: false, fallback: false, ...over })
  }
}

function run() {
  return useMission.getState().byConv[CONV]
}

/** Run-state REAL de missão interrompida (fixture do card de retomada). */
function interruptedState(): MissionRunState {
  return {
    version: 1,
    missionId: "m-crash-9999",
    dir: ".mycockpit/missions/m-crash",
    convId: CONV,
    task: "tarefa",
    preset: PRESET,
    current: 0,
    phases: [{ status: "running", costUsd: 0 }],
    costTotal: 0,
    maxCostUsd: null,
    gateDecisions: null,
    status: "running",
    updatedAt: 123,
  }
}

beforeEach(() => {
  h.results = []
  h.runCalls = 0
  h.ensureWaiters = []
  vi.clearAllMocks()
  useMission.setState({ byConv: {}, interrupted: {} })
  seedConv()
})

describe("janela de duplo-start no launch (guarda síncrona de verdade)", () => {
  it("dois launch SÍNCRONOS antes do ensure resolver → UM pipeline só (1 fase paga, nunca 2)", async () => {
    const p1 = launch()
    const p2 = launch() // duplo-clique: dispara ANTES do primeiro await resolver
    // só o primeiro launch chegou ao ensure (o segundo morreu na guarda)
    expect(h.ensureWaiters).toHaveLength(1)
    releaseEnsures()
    await Promise.all([p1, p2])

    expect(h.runCalls).toBe(1)
    expect(run()?.status).toBe("done")
    expect(run()?.phases).toHaveLength(1)
  })

  it("duplo-clique em Retomar (resumeInterrupted 2x síncrono) → um pipeline, card consumido no ato", async () => {
    useMission.setState({
      interrupted: { [CONV]: { state: interruptedState(), cwd: CWD } },
    })
    useMission.getState().resumeInterrupted(CONV, PROJ, CWD, "padrao")
    useMission.getState().resumeInterrupted(CONV, PROJ, CWD, "padrao")
    // o card saiu SINCRONAMENTE no primeiro clique (o segundo não acha entrada
    // e, mesmo se achasse, a guarda de byConv já barra o launch dele).
    expect(useMission.getState().interrupted[CONV]).toBeUndefined()
    expect(h.ensureWaiters.length).toBeLessThanOrEqual(1)
    releaseEnsures()
    await vi.waitFor(() => {
      expect(run()?.status).toBe("done")
    })

    expect(h.runCalls).toBe(1)
    // retomada preservou o missionId do arquivo (continuidade dos marcos)
    expect(run()?.id).toBe("m-crash-9999")
  })

  it("preparação recusada (sem worktree e sem confirmação) limpa a SEMENTE e devolve o card de retomada", async () => {
    useMission.setState({
      interrupted: { [CONV]: { state: interruptedState(), cwd: CWD } },
    })
    useMission.getState().resumeInterrupted(CONV, PROJ, CWD, "padrao")
    // durante a janela, a semente segura a guarda (estado existe e é running)
    expect(run()?.status).toBe("running")
    releaseEnsures({ ok: false })
    await vi.waitFor(() => {
      expect(run()).toBeUndefined()
    })

    // nada rodou, nada de "rodando" falso, e a oferta de retomada VOLTOU
    expect(h.runCalls).toBe(0)
    expect(useMission.getState().interrupted[CONV]).toBeDefined()
    const msgs = (useChat.getState().byId[CONV]?.items ?? [])
      .filter((it) => it.kind === "notice")
      .map((it) => (it as Extract<ChatItem, { kind: "notice" }>).message)
    expect(msgs.some((m) => m.includes("Missão não lançada"))).toBe(true)
  })
})
