// MH1.1 — LACUNAS do clamp de MAX_REVIEW_LOOPS (mission-hardening-plan):
// (1) reprovação na re-review da RODADA 2 não pode abrir rodada 3 — o clamp é
// ESTRUTURAL (nenhuma fase nova apendada, nenhum runPhase extra), não só a
// ressalva no fim; (2) o clamp precisa valer ATRAVÉS de um crash: missão
// retomada na re-review final, com as rodadas JÁ esgotadas antes do crash,
// não pode re-armar o loop e pagar rodadas extras.
//
// Modelado no mission.resume.test.ts (FS fake do run-state, round-trip real
// runToState→JSON→parseRunState) e no mission.review.test.ts (pareceres no
// formato REAL que o template do reviewer produz).

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import type { MissionRunState } from "@/lib/missionState"
import type { ChatItem } from "@/store/chat"

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

vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, cancelAgent: vi.fn(async () => {}) }
})

// destilação/entrega: espiona sem tocar no Tauri (as correções deste arquivo
// geram `corrections` — o distill real invocaria o agent helper).
vi.mock("@/lib/learning", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/learning")>()
  return {
    ...mod,
    buildLearningBlocks: vi.fn(async () => ({
      recall: null,
      lessons: null,
      lessonIds: [],
    })),
    markLessonsUsed: vi.fn(async () => {}),
    distillLesson: vi.fn(async () => {}),
  }
})
vi.mock("@/lib/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db")>()
  return {
    ...mod,
    insertDelivery: vi.fn(async () => {}),
    upsertMission: vi.fn(async () => {}),
    recordTurnCost: vi.fn(async () => {}),
  }
})

// FS fake do run-state (padrão mission.resume.test.ts): parser REAL.
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
    writeActivePointer: vi.fn(async () => {}),
    ensureMissionsGitignore: vi.fn(async () => {}),
    readInterruptedFor: vi.fn(async (cwd: string) => {
      const raw = h.disk.get(cwd)
      return raw ? mod.parseRunState(raw) : null
    }),
  }
})

import { useMission } from "./mission"

const CONV = "c1"
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

function preset(phases: MissionPhaseDef[]): MissionPreset {
  return { id: "t", name: "Teste", phases, maxCostUsd: null }
}

function textItem(text: string): ChatItem {
  return { kind: "text", id: crypto.randomUUID(), text }
}

function ok(costUsd = 0, items: ChatItem[] = []): PhaseResult {
  return { ok: true, items, costUsd, costSource: undefined }
}

/** Parecer REPROVADO no formato real do parecer do template do reviewer. */
function reprova(texto: string): PhaseResult {
  return ok(0.1, [textItem(texto)])
}

function launch(pre: MissionPreset): Promise<void> {
  return useMission
    .getState()
    .launch(CONV, pre, "tarefa", "proj1", CWD, "padrao")
}

function run() {
  return useMission.getState().byConv[CONV]
}

async function waitFor(cond: () => boolean, tries = 200): Promise<void> {
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
  vi.clearAllMocks()
  useMission.setState({ byConv: {}, interrupted: {} })
})

describe("MH1.1 · clamp de MAX_REVIEW_LOOPS é estrutural", () => {
  it("reprovação na re-review da rodada 2 NÃO abre rodada 3: nenhuma fase nova, nenhum runPhase extra", async () => {
    h.results = [
      ok(0.5), // executor
      reprova("NÃO APROVADO: falta o teste do caso vazio em src/sync.ts."),
      ok(0.3), // Corrigir (rodada 1)
      reprova("Ainda não está aprovado: o retry segue sem teste de regressão."),
      ok(0.3), // Corrigir (rodada 2)
      reprova("NÃO APROVADO: o caso de erro de rede continua sem cobertura."),
    ]
    await launch(
      preset([
        phaseDef({ id: "build", label: "Executar" }),
        phaseDef({ id: "review", label: "Revisar", persona: "reviewer" }),
      ]),
    )

    const r = run()
    expect(r.status).toBe("done")
    // o clamp segurou: exatamente 2 rodadas (4 fases apendadas), nunca uma 3ª
    expect(h.calls).toHaveLength(6)
    expect(r.phases.map((p) => p.def.label)).toEqual([
      "Executar",
      "Revisar",
      "Corrigir (rodada 1)",
      "Revisar (rodada 1)",
      "Corrigir (rodada 2)",
      "Revisar (rodada 2)",
    ])
    // e o desfecho é a RESSALVA (não uma rodada extra escondida)
    expect(r.reviewCaveat?.rounds).toBe(2)
  })

  // A PROMESSA do plano (MH1.1 + MH4.2): o clamp limita custo/loop — e um
  // crash no meio da re-review final não pode "zerar o contador". O run-state
  // (lib/missionState.ts) persiste o preset EFETIVO (com as fases corretivas
  // apendadas), mas NÃO persiste reviewLoops/lastReview (store/mission.ts:546
  // e :554 renascem zerados no launch da retomada) — se este teste ficar
  // VERMELHO, é essa perda que ele está provando.
  it("retomada pós-crash na re-review final com rodadas ESGOTADAS: reprovar de novo vira ressalva, nunca rodadas extras", async () => {
    const build = phaseDef({ id: "build", label: "Executar" })
    const review = phaseDef({ id: "review", label: "Revisar", persona: "reviewer" })
    // preset EFETIVO persistido antes do crash: 2 rodadas já apendadas (ids no
    // formato real `fix-<n>-<missionId.slice(0,6)>`, store/mission.ts:948).
    const mid = "m-crash-1234"
    const short = mid.slice(0, 6)
    const fix = (n: number): MissionPhaseDef => ({
      ...build,
      id: `fix-${n}-${short}`,
      label: `Corrigir (rodada ${n})`,
      instructions: "O reviewer NÃO aprovou. Corrija exatamente estes pontos…",
    })
    const rereview = (n: number): MissionPhaseDef => ({
      ...review,
      id: `rereview-${n}-${short}`,
      label: `Revisar (rodada ${n})`,
    })
    const state: MissionRunState = {
      version: 1,
      missionId: mid,
      dir: ".mycockpit/missions/m-crash",
      convId: CONV,
      task: "tarefa",
      preset: {
        id: "t",
        name: "Teste",
        phases: [build, review, fix(1), rereview(1), fix(2), rereview(2)],
        maxCostUsd: null,
      },
      current: 5, // crash DURANTE a re-review da rodada 2 (a última possível)
      phases: [
        { status: "done", costUsd: 0.5 },
        { status: "done", costUsd: 0.1 },
        { status: "done", costUsd: 0.3 },
        { status: "done", costUsd: 0.1 },
        { status: "done", costUsd: 0.3 },
        { status: "running", costUsd: 0 },
      ],
      costTotal: 1.3,
      maxCostUsd: null,
      gateDecisions: null,
      status: "running",
      updatedAt: 123,
    }
    h.disk.set(CWD, JSON.stringify(state))
    await useMission.getState().detectInterrupted(CONV, CWD)
    expect(useMission.getState().interrupted[CONV]).toBeDefined()

    // a re-review re-roda (comportamento documentado) e reprova DE NOVO.
    h.results = [
      reprova("NÃO APROVADO: o retry segue engolindo a exceção em src/sync.ts."),
    ]
    useMission.getState().resumeInterrupted(CONV, "proj1", CWD, "padrao")
    await waitFor(() => run()?.status === "done")

    // rodadas esgotadas ANTES do crash seguem esgotadas: só a re-review
    // re-rodou — sem "Corrigir (rodada 1)" duplicado, sem custo extra de loop.
    expect(h.calls).toHaveLength(1)
    expect(run().phases).toHaveLength(6)
    // e o desfecho é HONESTO: done com a ressalva carregando o parecer.
    expect(run().reviewCaveat).toBeTruthy()
    expect(run().reviewCaveat?.feedback).toContain("NÃO APROVADO")
  })
})
