// Histórico persistente da missão (pendência M2 do docs/mission-mode.md): a
// missão roda em memória (byConv), então o launch grava MARCOS no fio da
// conversa via useChat.appendItems — task+largada, fase concluída (notice +
// resumo curto), gate (perguntas/respostas), recuperação e fim (result). Sem
// isso a conversa reabria VAZIA após restart. Tudo BEST-EFFORT: falha de
// persistência nunca derruba a missão.
//
// Modelado no mission.recovery.test.ts: só runPhase (agent real) e readHandoff
// (FS do worktree) são mocados; os helpers puros de @/lib/mission seguem reais.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type { HandoffDoc } from "@/lib/missionHandoff"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"

// Estado compartilhado com as fábricas de mock (hoisted p/ o vi.mock enxergar).
const h = vi.hoisted(() => ({
  results: [] as PhaseResult[],
  handoffs: [] as (HandoffDoc | null)[],
}))

vi.mock("@/lib/mission", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/mission")>()
  return {
    ...mod,
    runPhase: vi.fn(async () => {
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

// readHandoff mocado p/ o teste de GATE (fora do Tauri o real devolve null e a
// missão nunca pausa). Consome h.handoffs em ordem; default = sem handoff.
vi.mock("@/lib/missionHandoff", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/missionHandoff")>()
  return {
    ...mod,
    readHandoff: vi.fn(async () => h.handoffs.shift() ?? null),
  }
})

// abort() cancela o run da fase corrente (invoke Tauri) — mocado p/ não vazar.
vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, cancelAgent: vi.fn(async () => {}) }
})

import { useMission } from "./mission"
import { useChat, type ChatItem, type ConvState } from "./chat"

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

function preset(
  phases: MissionPhaseDef[],
  maxCostUsd: number | null = null,
): MissionPreset {
  return { id: "t", name: "Teste", phases, maxCostUsd }
}

function textItem(text: string): ChatItem {
  return { kind: "text", id: crypto.randomUUID(), text }
}

function ok(costUsd = 0, items: ChatItem[] = []): PhaseResult {
  return { ok: true, items, costUsd, costSource: undefined }
}

/** Falha RECUPERÁVEL via item kind:"limit" no transcript. */
function limitFail(costUsd = 0): PhaseResult {
  const item: ChatItem = { kind: "limit", id: "l1", message: "limite da CLI" }
  return { ok: false, items: [item], costUsd, costSource: undefined, error: "limit_reached" }
}

/** Falha NÃO-recuperável (bug comum). */
function bugFail(costUsd = 0): PhaseResult {
  return { ok: false, items: [], costUsd, costSource: undefined, error: "erro de compilação no arquivo x" }
}

const CONV = "c1"
const PROJ = "proj1"

/** Conversa da missão JÁ carregada em byId (o launcher garante isso via
 *  ensureConversationLoaded) + metas do projeto (preserva o título fixo). */
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

function launch(pre: MissionPreset): Promise<void> {
  return useMission
    .getState()
    .launch(CONV, pre, "tarefa da missão", PROJ, "/tmp/proj", "padrao")
}

function items(): ChatItem[] {
  return useChat.getState().byId[CONV]?.items ?? []
}

function notices(): string[] {
  return items()
    .filter((it) => it.kind === "notice")
    .map((it) => (it as Extract<ChatItem, { kind: "notice" }>).message)
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

const realAppendItems = useChat.getState().appendItems

beforeEach(() => {
  h.results = []
  h.handoffs = []
  useMission.setState({ byConv: {} })
  useChat.setState({ appendItems: realAppendItems })
  seedConv()
})

describe("histórico da missão persiste na conversa (marcos via appendItems)", () => {
  it("LAUNCH grava o item user com a task + notice de largada", async () => {
    h.results = [ok(0.5)]
    await launch(preset([phaseDef()]))

    const user = items().find((it) => it.kind === "user")
    expect(user).toBeTruthy()
    expect((user as Extract<ChatItem, { kind: "user" }>).text).toBe(
      "tarefa da missão",
    )
    expect(notices()[0]).toContain("Missão iniciada")
    expect(notices()[0]).toContain("preset Teste")
    expect(notices()[0]).toContain("1 fases")
  })

  it("fase concluída grava notice (label/agent/custo) + resumo da fase (phaseText)", async () => {
    h.results = [ok(0.5, [textItem("resumo do plano")])]
    await launch(preset([phaseDef({ label: "Planejar", agent: "codex" })]))

    const phaseNotice = notices().find((m) => m.startsWith("Fase 1/1"))
    expect(phaseNotice).toContain("Planejar")
    expect(phaseNotice).toContain("codex")
    expect(phaseNotice).toContain("US$ 0.50")
    const texts = items()
      .filter((it) => it.kind === "text")
      .map((it) => (it as Extract<ChatItem, { kind: "text" }>).text)
    expect(texts).toContain("resumo do plano")
  })

  it("resumo MUITO longo é truncado (~2000 chars + reticências)", async () => {
    h.results = [ok(0, [textItem("x".repeat(3000))])]
    await launch(preset([phaseDef()]))

    const long = items().find(
      (it) => it.kind === "text" && it.text.startsWith("x"),
    ) as Extract<ChatItem, { kind: "text" }>
    expect(long.text.length).toBe(2001) // 2000 + "…"
    expect(long.text.endsWith("…")).toBe(true)
  })

  it("DONE grava o item result (ok + custo total da missão)", async () => {
    h.results = [ok(0.4), ok(0.6)]
    await launch(preset([phaseDef(), phaseDef({ id: "p2" })]))

    expect(run().status).toBe("done")
    const res = items().find((it) => it.kind === "result") as Extract<
      ChatItem,
      { kind: "result" }
    >
    expect(res.ok).toBe(true)
    expect(res.costUsd).toBeCloseTo(1.0, 5)
    expect(res.text).toContain("Missão concluída")
  })

  it("GATE grava as perguntas ao pausar e as respostas ao retomar", async () => {
    h.results = [ok(0.1), ok(0.2)]
    // handoff da fase 1 com open_questions → gate; demais leituras sem handoff.
    h.handoffs = [
      {
        intent: "fazer x",
        decisions: [],
        open_questions: ["Qual porta?", "Fixtures ou live?"],
        files_touched: [],
        for_next_agent: "",
      },
    ]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })]))

    await waitFor(() => !!run()?.gate)
    expect(notices().some((m) => m.includes("Gate humano"))).toBe(true)
    expect(notices().some((m) => m.includes("Qual porta?"))).toBe(true)

    useMission.getState().answerGate(CONV, ["5175", ""])
    await waitFor(() => run()?.status === "done")
    await p

    const answered = notices().find((m) => m.includes("Gate respondido"))
    expect(answered).toContain("5175")
    expect(answered).toContain("(sem resposta, o agente decide)")
  })

  it("RECOVERY grava o notice de retomada com o agent novo", async () => {
    h.results = [limitFail(0.5), ok(0.7)]
    const p = launch(preset([phaseDef({ label: "Executar" })]))

    await waitFor(() => !!run()?.recovery)
    useMission
      .getState()
      .resolveRecovery(CONV, { agent: "codex", model: null, effort: null })
    await waitFor(() => run()?.status === "done")
    await p

    const resumed = notices().find((m) => m.includes("retomada com"))
    expect(resumed).toContain("Executar")
    expect(resumed).toContain("parou por limite")
    expect(resumed).toContain("codex")
  })

  it("ERROR (falha não-recuperável) grava result !ok com o motivo", async () => {
    h.results = [bugFail(0.6)]
    await launch(preset([phaseDef()]))

    expect(run().status).toBe("error")
    const res = items().find((it) => it.kind === "result") as Extract<
      ChatItem,
      { kind: "result" }
    >
    expect(res.ok).toBe(false)
    expect(res.costUsd).toBeCloseTo(0.6, 5)
    expect(res.text).toContain("erro de compilação")
  })

  it("ABORT (Stop) grava result !ok de interrupção", async () => {
    h.results = [limitFail(0.2)]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })]))

    await waitFor(() => !!run()?.recovery)
    useMission.getState().abort(CONV)
    await p
    // o marco do abort é fire-and-forget → drena a microtask queue.
    await waitFor(() => items().some((it) => it.kind === "result"))

    const res = items().find((it) => it.kind === "result") as Extract<
      ChatItem,
      { kind: "result" }
    >
    expect(res.ok).toBe(false)
    expect(res.text).toContain("interrompida pelo usuário")
  })

  it("falha do appendItems NÃO derruba a missão (best-effort de verdade)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    useChat.setState({
      appendItems: vi.fn(async () => {
        throw new Error("disco cheio")
      }),
    })
    h.results = [ok(0.3)]
    await launch(preset([phaseDef()]))

    expect(run().status).toBe("done") // a missão concluiu mesmo sem persistir
    expect(items()).toEqual([]) // nada gravado (o append rejeitou)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
