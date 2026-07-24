// Testes das aprovações CONTEXTUAIS (store/interactions):
// - convIdForInteraction: mapeamento request→conversa (extraído do bridge/
//   derive — turno linear por runId, missão por prefixo `missionId::phase-N`,
//   question sempre null);
// - computeContextualSplit: split por visibilidade (conversa visível ⇒ inline;
//   não-ativa / outro viewMode / agendado ⇒ toast global);
// - responder inline remove da fila (o global nunca pisca o mesmo request).

import { beforeEach, describe, expect, it, vi } from "vitest"
import { answerInteraction, type InteractionRequest } from "@/lib/interaction"
import type {
  MissionPersona,
  MissionPhaseDef,
  MissionPhaseRun,
  MissionRun,
} from "@/lib/missionTypes"
import { useApp } from "@/store/app"
import { useChat, type ConvState } from "@/store/chat"
import { useMission } from "@/store/mission"
import {
  computeContextualSplit,
  convIdForInteraction,
  useInteractions,
} from "./interactions"

// Só o efeito (invoke Tauri) é mocado; failClosedAnswer & cia seguem reais.
vi.mock("@/lib/interaction", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/interaction")>()
  return { ...mod, answerInteraction: vi.fn(async () => {}) }
})

// ── factories locais (espelham as do derive.test) ───────────────────────────

function conversa(
  projectId: string,
  patch: Partial<ConvState> = {},
): ConvState {
  return {
    projectId,
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
    ...patch,
  }
}

function fase(persona: MissionPersona, agent: string): MissionPhaseDef {
  return {
    id: persona,
    label: persona,
    persona,
    agent,
    model: null,
    effort: null,
    maxRetries: 1,
  }
}

function faseRun(def: MissionPhaseDef): MissionPhaseRun {
  return { def, status: "queued", attempt: 1, costUsd: 0, startedAt: null }
}

function missao(convId: string, patch: Partial<MissionRun> = {}): MissionRun {
  return {
    id: "m1",
    convId,
    presetName: "Feature completa",
    dir: ".mycockpit/missions/test",
    task: "tarefa",
    phases: [
      faseRun(fase("planner", "claude-code")),
      faseRun(fase("executor", "codex")),
      faseRun(fase("reviewer", "claude-code")),
    ],
    current: 0,
    costTotal: 0,
    maxCostUsd: null,
    status: "running",
    startedAt: 0,
    ...patch,
  }
}

function aprovacao(id: string, runId: string): InteractionRequest {
  return {
    id,
    kind: "approval",
    data: { run_id: runId, tool_name: "Bash", command: "ls", input: {} },
  }
}

function pergunta(id: string): InteractionRequest {
  return {
    id,
    kind: "question",
    data: {
      questions: [
        { header: "H", question: "Q?", multiSelect: false, options: [{ label: "a", description: "" }] },
      ],
    },
  }
}

beforeEach(() => {
  useInteractions.setState({ queue: [] })
  useChat.setState({
    projectId: null,
    activeId: null,
    conversations: [],
    conversationsByProject: {},
    byId: {},
    drafts: {},
    queuedPrompt: null,
  })
  useMission.setState({ byConv: {} })
  useApp.setState({ viewMode: "linear", scheduledOpen: false })
  vi.mocked(answerInteraction).mockClear()
})

// ── mapeamento request→conversa ─────────────────────────────────────────────

describe("convIdForInteraction", () => {
  it("turno linear: run_id igual ao runId corrente da conversa", () => {
    const chat = { byId: { c1: { runId: "r-1" }, c2: { runId: null } } }
    expect(
      convIdForInteraction(aprovacao("i1", "r-1"), chat, { byConv: {} }),
    ).toEqual({ convId: "c1", kind: "linear" })
  })

  it("missão: prefixo missionId:: com sufixo phase-N resolve a fase", () => {
    const missions = {
      byConv: { c1: { id: "m1", current: 0, phases: [{}, {}, {}] } },
    }
    expect(
      convIdForInteraction(aprovacao("i1", "m1::phase-1"), { byId: {} }, missions),
    ).toEqual({ convId: "c1", kind: "mission", phase: 1 })
  })

  it("missão: sufixo em outro formato cai na fase corrente", () => {
    const missions = {
      byConv: { c1: { id: "m1", current: 2, phases: [{}, {}, {}] } },
    }
    expect(
      convIdForInteraction(aprovacao("i1", "m1::retry-x"), { byId: {} }, missions),
    ).toEqual({ convId: "c1", kind: "mission", phase: 2 })
  })

  it("question nunca mapeia (não carrega run_id) — host global cobre", () => {
    const chat = { byId: { c1: { runId: "r-1" } } }
    expect(convIdForInteraction(pergunta("q1"), chat, { byConv: {} })).toBeNull()
  })

  it("approval sem run_id / run_id desconhecido → null", () => {
    const semRunId: InteractionRequest = {
      id: "i1",
      kind: "approval",
      data: { tool_name: "Bash", command: "ls", input: {} },
    }
    const chat = { byId: { c1: { runId: "r-1" } } }
    expect(convIdForInteraction(semRunId, chat, { byConv: {} })).toBeNull()
    expect(
      convIdForInteraction(aprovacao("i2", "r-999"), chat, { byConv: {} }),
    ).toBeNull()
  })
})

// ── split por visibilidade ──────────────────────────────────────────────────

describe("computeContextualSplit", () => {
  it("conversa dona VISÍVEL (linear + ativa) ⇒ inline; toast global suprime", () => {
    useChat.setState({
      activeId: "c1",
      byId: { c1: conversa("p1", { runId: "r-1", running: true }) },
    })
    const req = aprovacao("i1", "r-1")
    useInteractions.setState({ queue: [req] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([req])
    expect(split.inlineConvId).toBe("c1")
    expect(split.global).toEqual([])
  })

  it("conversa dona NÃO-ativa ⇒ global (outra conversa na tela)", () => {
    useChat.setState({
      activeId: "c2",
      byId: {
        c1: conversa("p1", { runId: "r-1", running: true }),
        c2: conversa("p1"),
      },
    })
    const req = aprovacao("i1", "r-1")
    useInteractions.setState({ queue: [req] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([])
    expect(split.inlineConvId).toBeNull()
    expect(split.global).toEqual([req])
  })

  it("viewMode office ⇒ tudo global (o office tem os próprios beacons)", () => {
    useApp.setState({ viewMode: "office" })
    useChat.setState({
      activeId: "c1",
      byId: { c1: conversa("p1", { runId: "r-1", running: true }) },
    })
    const req = aprovacao("i1", "r-1")
    useInteractions.setState({ queue: [req] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([])
    expect(split.global).toEqual([req])
  })

  it("view Agendado aberta (scheduledOpen) ⇒ global mesmo no linear", () => {
    useApp.setState({ scheduledOpen: true })
    useChat.setState({
      activeId: "c1",
      byId: { c1: conversa("p1", { runId: "r-1", running: true }) },
    })
    const req = aprovacao("i1", "r-1")
    useInteractions.setState({ queue: [req] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([])
    expect(split.global).toEqual([req])
  })

  it("question sem run_id ⇒ SEMPRE global, mesmo com conversa visível", () => {
    useChat.setState({
      activeId: "c1",
      byId: { c1: conversa("p1", { runId: "r-1", running: true }) },
    })
    const ap = aprovacao("i1", "r-1")
    const q = pergunta("q1")
    useInteractions.setState({ queue: [q, ap] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([ap])
    expect(split.global).toEqual([q])
  })

  it("fase de missão (run_id missionId::phase-N) da conversa visível ⇒ inline", () => {
    useChat.setState({ activeId: "c1", byId: { c1: conversa("p1") } })
    useMission.setState({ byConv: { c1: missao("c1", { current: 1 }) } })
    const req = aprovacao("i1", "m1::phase-1")
    useInteractions.setState({ queue: [req] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([req])
    expect(split.inlineConvId).toBe("c1")
    expect(split.global).toEqual([])
  })
})

// ── responder inline remove da fila ─────────────────────────────────────────

describe("answer inline", () => {
  it("responder pelo card inline remove da fila NA HORA — o global nunca pisca", () => {
    useChat.setState({
      activeId: "c1",
      byId: { c1: conversa("p1", { runId: "r-1", running: true }) },
    })
    const req = aprovacao("i1", "r-1")
    useInteractions.setState({ queue: [req] })
    expect(computeContextualSplit().inline).toEqual([req])

    useInteractions.getState().answer("i1", { allow: true })
    expect(useInteractions.getState().queue).toHaveLength(0)
    const after = computeContextualSplit()
    expect(after.inline).toEqual([])
    expect(after.global).toEqual([])
    expect(answerInteraction).toHaveBeenCalledWith("i1", { allow: true })
  })
})
