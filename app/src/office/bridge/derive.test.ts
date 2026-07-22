// Testes da derivação (bridge/derive.ts): missão→mesa, approval por prefixo
// missionId::, agregado da sala, coalescing/dedupe do startDeriving.
// Factories locais manipulam os stores reais (setState) — fora do Tauri os
// caminhos de DB são no-op, então nada toca disco. A fila de interações é a
// do useInteractions (fonte única): os testes alimentam por push/resolve.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { OfficeSnapshot } from "@/office/engine/types"
import type { AgentProbe } from "@/lib/detect"
import type {
  MissionPersona,
  MissionPhaseDef,
  MissionPhaseRun,
  MissionRun,
} from "@/lib/missionTypes"
import type { Project } from "@/lib/types"
import { useApp } from "@/store/app"
import { useChat, type ChatItem, type ConvState } from "@/store/chat"
import {
  useFusion,
  type FusionCandidate,
  type FusionRun,
} from "@/store/fusion"
import { useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"
import {
  _resetDeriveState,
  deriveOfficeSnapshot,
  deskBaseState,
  offInstruction,
  startDeriving,
} from "./derive"

// ── factories locais ────────────────────────────────────────────────────────

function projeto(id: string, name = id): Project {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    createdAt: 0,
    permissionMode: "padrao",
    color: null,
    status: "idle",
  }
}

function conversa(
  projectId: string,
  agent = "claude-code",
  patch: Partial<ConvState> = {},
): ConvState {
  return {
    projectId,
    agent,
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
    label:
      persona === "planner"
        ? "Planejar"
        : persona === "executor"
          ? "Executar"
          : "Revisar",
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

function textoItem(text: string): ChatItem {
  return { kind: "text", id: crypto.randomUUID(), text }
}

function candidato(agent: string): FusionCandidate {
  return {
    id: `cand-${agent}`,
    runId: `run-${agent}`,
    agent,
    reqModel: null,
    effort: null,
    label: agent,
    status: "running",
    items: [],
    sessionId: null,
    model: null,
    streamingTextId: null,
    startedAt: null,
    finishOrder: null,
    cwd: "/tmp/p1",
  }
}

function fusion(convId: string, patch: Partial<FusionRun> = {}): FusionRun {
  return {
    id: "f1",
    convId,
    itemId: null,
    prompt: "disputa",
    preamble: null,
    attachments: [],
    scope: "read-only",
    phase: "running",
    candidates: [candidato("claude-code"), candidato("codex")],
    judge: {
      status: "idle",
      suggestedId: null,
      rationale: null,
      agreement: null,
      runnerupId: null,
      passes: [],
      notes: {},
    },
    chosenId: null,
    judgeModel: "haiku",
    costTotal: 0,
    costDiscarded: 0,
    createdAt: 0,
    ...patch,
  }
}

function autoResume(nextAt: number): ConvState["autoResume"] {
  return {
    tries: 1,
    maxTries: 5,
    nextAt,
    reason: "Limite da CLI",
    timer: 0 as unknown as ReturnType<typeof setTimeout>,
  }
}

function setDetected(detected: Record<string, AgentProbe>) {
  useApp.setState({
    settings: { ...useApp.getState().settings, detected },
  })
}

function mesa(snap: OfficeSnapshot, projectId: string, agent: string) {
  const room = snap.rooms.find((r) => r.projectId === projectId)
  const desk = room?.desks.find((d) => d.agent === agent)
  if (!desk) throw new Error(`mesa ${projectId}::${agent} não existe no snapshot`)
  return desk
}

beforeEach(() => {
  _resetDeriveState()
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
  useFusion.setState({ byConv: {} })
  useApp.setState({ projects: [projeto("p1")], limitedAgents: {} })
  setDetected({})
})

afterEach(() => {
  vi.useRealTimers()
})

// ── missão → mesa ───────────────────────────────────────────────────────────

describe("deriveOfficeSnapshot — missão", () => {
  it("fase corrente acende a mesa do agent da fase com o label da persona", () => {
    useChat.setState({ byId: { c1: conversa("p1") } })
    useMission.setState({ byConv: { c1: missao("c1", { current: 1 }) } })

    const snap = deriveOfficeSnapshot()
    const codex = mesa(snap, "p1", "codex")
    expect(codex.state).toBe("thinking") // sem items da fase = silêncio
    expect(codex.label).toBe("Executando")
    expect(codex.convId).toBe("c1")
    // as demais mesas da sala seguem em espera
    expect(mesa(snap, "p1", "claude-code").state).toBe("idle")
    expect(mesa(snap, "p1", "agy").state).toBe("idle")
  })

  it("gate humano ⇒ mão levantada (hand:'gate') na mesa do agent da fase", () => {
    useChat.setState({ byId: { c1: conversa("p1") } })
    useMission.setState({
      byConv: {
        c1: missao("c1", {
          current: 0,
          gate: { phase: 0, questions: ["Posso abrir o socket?"] },
        }),
      },
    })

    const desk = mesa(deriveOfficeSnapshot(), "p1", "claude-code")
    expect(desk.state).toBe("hand")
    expect(desk.hand).toBe("gate")
    expect(desk.label).toBe("Precisa de você")
  })

  it("custo da missão EM VOO entra no costUsd da sala", () => {
    useChat.setState({ byId: { c1: conversa("p1") } })
    useMission.setState({
      byConv: { c1: missao("c1", { costTotal: 2.5 }) },
    })
    const room = deriveOfficeSnapshot().rooms[0]
    expect(room.costUsd).toBeCloseTo(2.5)
  })
})

// ── handoff físico (transição de fase com agent diferente) ──────────────────

describe("deriveOfficeSnapshot — handoffs", () => {
  const t0 = 5_000_000

  it("fase done → próxima com agent DIFERENTE vira handoff (e expira em 20s)", () => {
    useChat.setState({ byId: { c1: conversa("p1") } })
    useMission.setState({ byConv: { c1: missao("c1", { current: 0 }) } })
    deriveOfficeSnapshot(t0) // memoriza current=0 (nenhum handoff no 1º derive)

    const m = missao("c1", { current: 1 })
    m.phases[0].status = "done"
    m.phases[1].status = "running"
    useMission.setState({ byConv: { c1: m } })

    const snap = deriveOfficeSnapshot(t0 + 1000)
    expect(snap.handoffs).toEqual([
      { fromDeskId: "p1::claude-code", toDeskId: "p1::codex", at: t0 + 1000 },
    ])
    // não re-emite no derive seguinte (memória de fase), mas segue vivo no TTL
    expect(deriveOfficeSnapshot(t0 + 2000).handoffs).toHaveLength(1)
    // 20s depois expira
    expect(deriveOfficeSnapshot(t0 + 25_000).handoffs).toHaveLength(0)
  })

  it("mesmo agent nas duas fases ⇒ sem handoff (nada de courier pra si mesmo)", () => {
    const phases = [
      faseRun(fase("planner", "claude-code")),
      faseRun(fase("executor", "claude-code")),
    ]
    useChat.setState({ byId: { c1: conversa("p1") } })
    useMission.setState({ byConv: { c1: missao("c1", { phases, current: 0 }) } })
    deriveOfficeSnapshot(t0)

    const done = [faseRun(fase("planner", "claude-code")), faseRun(fase("executor", "claude-code"))]
    done[0].status = "done"
    done[1].status = "running"
    useMission.setState({ byConv: { c1: missao("c1", { phases: done, current: 1 }) } })
    expect(deriveOfficeSnapshot(t0 + 1000).handoffs).toHaveLength(0)
  })

  it("missão histórica vista já na fase 1 no PRIMEIRO derive não gera handoff", () => {
    useChat.setState({ byId: { c1: conversa("p1") } })
    const m = missao("c1", { current: 1 })
    m.phases[0].status = "done"
    useMission.setState({ byConv: { c1: m } })
    expect(deriveOfficeSnapshot(t0).handoffs).toHaveLength(0)
  })

  it("fase anterior NÃO done (falha/retry) não gera handoff", () => {
    useChat.setState({ byId: { c1: conversa("p1") } })
    useMission.setState({ byConv: { c1: missao("c1", { current: 0 }) } })
    deriveOfficeSnapshot(t0)

    const m = missao("c1", { current: 1 })
    m.phases[0].status = "error"
    useMission.setState({ byConv: { c1: m } })
    expect(deriveOfficeSnapshot(t0 + 1000).handoffs).toHaveLength(0)
  })
})

// ── approvals pendentes (fila do useInteractions) ───────────────────────────

describe("deriveOfficeSnapshot — approvals", () => {
  it("run_id com prefixo missionId:: mapeia pra mesa da fase da missão", () => {
    useChat.setState({ byId: { c1: conversa("p1") } })
    useMission.setState({ byConv: { c1: missao("c1", { current: 1 }) } })
    useInteractions.getState().push({
      id: "i1",
      kind: "approval",
      data: {
        run_id: "m1::phase-1",
        tool_name: "Bash",
        command: "rm -rf dist",
        input: {},
      },
    })

    const desk = mesa(deriveOfficeSnapshot(), "p1", "codex")
    expect(desk.state).toBe("hand")
    expect(desk.hand).toBe("approval")
    expect(desk.detail).toBe("rm -rf dist")

    // resolvido pelo backend (Drop fail-closed) ⇒ a mão abaixa (volta à fase)
    useInteractions.getState().resolve("i1")
    expect(mesa(deriveOfficeSnapshot(), "p1", "codex").state).toBe("thinking")
  })

  it("responder pelo card abaixa a mão NA HORA (answer remove da fila)", () => {
    // o backend NÃO emite interaction://resolved pra respostas do usuário —
    // a mão só abaixa porque answer() remove da fila local imediatamente.
    useChat.setState({ byId: { c1: conversa("p1") } })
    useMission.setState({ byConv: { c1: missao("c1", { current: 1 }) } })
    useInteractions.getState().push({
      id: "i1",
      kind: "approval",
      data: { run_id: "m1::phase-1", tool_name: "Bash", command: "ls", input: {} },
    })
    expect(mesa(deriveOfficeSnapshot(), "p1", "codex").state).toBe("hand")

    useInteractions.getState().answer("i1", { allow: true })
    expect(useInteractions.getState().queue).toHaveLength(0)
    expect(mesa(deriveOfficeSnapshot(), "p1", "codex").state).toBe("thinking")
  })

  it("run_id igual ao runId da conversa (turno linear) levanta a mão na mesa", () => {
    useChat.setState({
      byId: {
        c1: conversa("p1", "claude-code", { running: true, runId: "r-77" }),
      },
    })
    useInteractions.getState().push({
      id: "i2",
      kind: "approval",
      data: { run_id: "r-77", tool_name: "Write", command: "", input: {} },
    })

    const desk = mesa(deriveOfficeSnapshot(), "p1", "claude-code")
    expect(desk.state).toBe("hand")
    expect(desk.hand).toBe("approval")
    expect(desk.convId).toBe("c1")
  })

  it("question sem run_id é ignorada (o host global cobre)", () => {
    useChat.setState({
      byId: { c1: conversa("p1", "claude-code", { running: true, runId: "r-1" }) },
    })
    useInteractions.getState().push({
      id: "i3",
      kind: "question",
      data: {
        questions: [
          {
            header: "Rumo",
            question: "Qual abordagem?",
            multiSelect: false,
            options: [{ label: "A", description: "" }],
          },
        ],
      },
    })

    // segue na fila (o card global mostra), mas nenhuma mesa levanta a mão
    expect(useInteractions.getState().queue).toHaveLength(1)
    const desk = mesa(deriveOfficeSnapshot(), "p1", "claude-code")
    expect(desk.state).not.toBe("hand")
  })
})

// ── agregado da sala e estados base ─────────────────────────────────────────

describe("deriveOfficeSnapshot — agregado e estados", () => {
  it("agregado prioriza hand > running > idle", () => {
    // hand vence mesmo com outra mesa digitando
    useChat.setState({
      byId: {
        c1: conversa("p1", "claude-code", {
          running: true,
          runId: "r-1",
          items: [textoItem("streaming…")],
        }),
        c2: conversa("p1", "codex", { running: true, runId: "r-2" }),
      },
    })
    useInteractions.getState().push({
      id: "i1",
      kind: "approval",
      data: { run_id: "r-2", tool_name: "Bash", command: "x", input: {} },
    })
    expect(deriveOfficeSnapshot().rooms[0].agg).toBe("hand")

    // sem hand, turno rodando ⇒ running
    useInteractions.getState().resolve("i1")
    expect(deriveOfficeSnapshot().rooms[0].agg).toBe("running")

    // tudo parado ⇒ idle
    useChat.setState({ byId: {} })
    useMission.setState({ byConv: {} })
    _resetDeriveState()
    expect(deriveOfficeSnapshot().rooms[0].agg).toBe("idle")
  })

  it("turno com output recente ⇒ typing; silêncio ⇒ thinking", () => {
    useChat.setState({
      byId: {
        c1: conversa("p1", "claude-code", {
          running: true,
          runId: "r-1",
          items: [textoItem("gerando resposta")],
        }),
      },
    })
    const t0 = 1_000_000
    // 1º derive vê o item novo ⇒ atividade agora ⇒ digitando
    expect(mesa(deriveOfficeSnapshot(t0), "p1", "claude-code").state).toBe(
      "typing",
    )
    // 3s depois SEM mudança nos items ⇒ pensando
    expect(
      mesa(deriveOfficeSnapshot(t0 + 3000), "p1", "claude-code").state,
    ).toBe("thinking")
  })

  it("CLI não detectado ⇒ mesa off (fonte: settings.detected)", () => {
    setDetected({
      codex: {
        installed: false,
        version: null,
        auth: "na",
        detail: null,
        latest: null,
        checkedAt: 1,
      },
    })
    const snap = deriveOfficeSnapshot()
    expect(mesa(snap, "p1", "codex").state).toBe("off")
    expect(mesa(snap, "p1", "codex").label).toBe("Não detectado")
    // agent sem probe segue ligado (degrada pro comportamento atual)
    expect(mesa(snap, "p1", "claude-code").state).toBe("idle")
  })

  it("fim de turno vira balão de entrega (e expira depois de 15s)", () => {
    const t0 = 2_000_000
    useChat.setState({
      byId: {
        c1: conversa("p1", "claude-code", { running: true, runId: "r-1" }),
      },
    })
    deriveOfficeSnapshot(t0) // observa a conversa rodando

    useChat.setState({
      byId: {
        c1: conversa("p1", "claude-code", {
          running: false,
          items: [
            { kind: "result", id: "res-1", ok: true, text: "Refatorei o parser." },
          ],
        }),
      },
    })
    const snap = deriveOfficeSnapshot(t0 + 1000)
    expect(snap.deliveries).toHaveLength(1)
    expect(snap.deliveries[0].deskId).toBe("p1::claude-code")
    expect(snap.deliveries[0].convId).toBe("c1")
    expect(snap.deliveries[0].text).toContain("Refatorei")
    // 15s depois o balão expira
    expect(deriveOfficeSnapshot(t0 + 20_000).deliveries).toHaveLength(0)
  })
})

// ── persona + restUntil (sinais na mesa) ────────────────────────────────────

describe("deriveOfficeSnapshot — persona e restUntil", () => {
  it("mesa da fase corrente carrega a persona; as demais não", () => {
    useChat.setState({ byId: { c1: conversa("p1") } })
    useMission.setState({ byConv: { c1: missao("c1", { current: 1 }) } })

    const snap = deriveOfficeSnapshot()
    expect(mesa(snap, "p1", "codex").persona).toBe("executor")
    expect(mesa(snap, "p1", "claude-code").persona).toBeUndefined()
  })

  it("gate humano também carrega a persona da fase do gate", () => {
    useChat.setState({ byId: { c1: conversa("p1") } })
    useMission.setState({
      byConv: {
        c1: missao("c1", {
          current: 0,
          gate: { phase: 0, questions: ["Sigo?"] },
        }),
      },
    })
    expect(mesa(deriveOfficeSnapshot(), "p1", "claude-code").persona).toBe(
      "planner",
    )
  })

  it("conv com autoResume agendado ⇒ restUntil na mesa do agent", () => {
    const t0 = 1_000_000
    useChat.setState({
      byId: {
        c1: conversa("p1", "claude-code", { autoResume: autoResume(t0 + 60_000) }),
      },
    })
    const desk = mesa(deriveOfficeSnapshot(t0), "p1", "claude-code")
    expect(desk.restUntil).toBe(t0 + 60_000)
    // sem autoResume, nada de descanso
    useChat.setState({ byId: { c1: conversa("p1") } })
    expect(
      mesa(deriveOfficeSnapshot(t0 + 1000), "p1", "claude-code").restUntil,
    ).toBeUndefined()
  })
})

// ── room.mission (kanban do whiteboard) ─────────────────────────────────────

describe("deriveOfficeSnapshot — room.mission", () => {
  it("missão ativa vira kanban da sala (phases, current, executorDeskId)", () => {
    useChat.setState({ byId: { c1: conversa("p1") } })
    const m = missao("c1", { current: 1 })
    m.phases[0].status = "done"
    m.phases[1].status = "running"
    useMission.setState({ byConv: { c1: m } })

    const room = deriveOfficeSnapshot().rooms[0]
    expect(room.mission).toEqual({
      phases: [
        { label: "Planejar", persona: "planner", agent: "claude-code", status: "done" },
        { label: "Executar", persona: "executor", agent: "codex", status: "running" },
        { label: "Revisar", persona: "reviewer", agent: "claude-code", status: "queued" },
      ],
      current: 1,
      executorDeskId: "p1::codex",
    })
  })

  it("missão done persiste no quadro, sem executorDeskId (current além do fim)", () => {
    useChat.setState({ byId: { c1: conversa("p1") } })
    const m = missao("c1", { current: 3, status: "done" })
    for (const ph of m.phases) ph.status = "done"
    useMission.setState({ byConv: { c1: m } })

    const room = deriveOfficeSnapshot().rooms[0]
    expect(room.mission?.current).toBe(3)
    expect(room.mission?.executorDeskId).toBeUndefined()
  })

  it("sala sem missão não tem kanban", () => {
    expect(deriveOfficeSnapshot().rooms[0].mission).toBeUndefined()
  })
})

// ── room.war (disputa Fusion) ───────────────────────────────────────────────

describe("deriveOfficeSnapshot — room.war", () => {
  it("disputa ativa ⇒ war com as mesas dos candidatos mapeáveis", () => {
    useChat.setState({ byId: { c1: conversa("p1") } })
    useFusion.setState({ byConv: { c1: fusion("c1") } })

    expect(deriveOfficeSnapshot().rooms[0].war).toEqual({
      deskIds: ["p1::claude-code", "p1::codex"],
    })
  })

  it("nenhum candidato mapeável ⇒ as 3 mesas da sala", () => {
    useChat.setState({ byId: { c1: conversa("p1") } })
    useFusion.setState({
      byConv: { c1: fusion("c1", { candidates: [candidato("gpt-oss")] }) },
    })

    expect(deriveOfficeSnapshot().rooms[0].war).toEqual({
      deskIds: ["p1::claude-code", "p1::codex", "p1::agy"],
    })
  })

  it("fusion done/aborted/configuring ⇒ sem war", () => {
    useChat.setState({ byId: { c1: conversa("p1") } })
    for (const phase of ["done", "aborted", "configuring"] as const) {
      useFusion.setState({ byConv: { c1: fusion("c1", { phase }) } })
      expect(deriveOfficeSnapshot().rooms[0].war).toBeUndefined()
    }
    // judging ainda é disputa
    useFusion.setState({ byConv: { c1: fusion("c1", { phase: "judging" }) } })
    expect(deriveOfficeSnapshot().rooms[0].war).toBeDefined()
  })
})

// ── kickoffs e celebrações ──────────────────────────────────────────────────

describe("deriveOfficeSnapshot — kickoffs e celebrações", () => {
  const t0 = 7_000_000

  it("missão ausente→running vira kickoff com as mesas ÚNICAS das fases (TTL 25s, sem re-emitir)", () => {
    useChat.setState({ byId: { c1: conversa("p1") } })
    useMission.setState({ byConv: { c1: missao("c1") } })

    const snap = deriveOfficeSnapshot(t0)
    expect(snap.kickoffs).toEqual([
      // claude-code aparece em 2 fases mas a mesa entra UMA vez
      { projectId: "p1", deskIds: ["p1::claude-code", "p1::codex"], at: t0 },
    ])
    // segue running ⇒ não re-emite (memória de status), mas vive até o TTL
    expect(deriveOfficeSnapshot(t0 + 1000).kickoffs).toHaveLength(1)
    expect(deriveOfficeSnapshot(t0 + 30_000).kickoffs).toHaveLength(0)
  })

  it("running→done vira celebração (TTL 12s)", () => {
    useChat.setState({ byId: { c1: conversa("p1") } })
    useMission.setState({ byConv: { c1: missao("c1") } })
    deriveOfficeSnapshot(t0) // memoriza running
    expect(deriveOfficeSnapshot(t0).celebrations).toHaveLength(0)

    useMission.setState({
      byConv: { c1: missao("c1", { status: "done", current: 3 }) },
    })
    const snap = deriveOfficeSnapshot(t0 + 1000)
    expect(snap.celebrations).toEqual([{ projectId: "p1", at: t0 + 1000 }])
    // sem re-emitir; expira em 12s
    expect(deriveOfficeSnapshot(t0 + 2000).celebrations).toHaveLength(1)
    expect(deriveOfficeSnapshot(t0 + 14_000).celebrations).toHaveLength(0)
  })

  it("missão já done no 1º derive é histórica: nem kickoff nem celebração", () => {
    useChat.setState({ byId: { c1: conversa("p1") } })
    useMission.setState({
      byConv: { c1: missao("c1", { status: "done", current: 3 }) },
    })
    const snap = deriveOfficeSnapshot(t0)
    expect(snap.kickoffs).toHaveLength(0)
    expect(snap.celebrations).toHaveLength(0)
  })
})

// ── batons (revezamento: agent da conversa mudou) ───────────────────────────

describe("deriveOfficeSnapshot — batons", () => {
  const t0 = 8_000_000

  it("agent da conv COM items mudou entre derives ⇒ bastão (TTL 20s)", () => {
    const items = [textoItem("trabalho feito")]
    useChat.setState({ byId: { c1: conversa("p1", "claude-code", { items }) } })
    expect(deriveOfficeSnapshot(t0).batons).toHaveLength(0) // 1º só memoriza

    useChat.setState({ byId: { c1: conversa("p1", "codex", { items }) } })
    const snap = deriveOfficeSnapshot(t0 + 1000)
    expect(snap.batons).toEqual([
      { fromDeskId: "p1::claude-code", toDeskId: "p1::codex", at: t0 + 1000 },
    ])
    // dedupe (memória atualizada) + TTL
    expect(deriveOfficeSnapshot(t0 + 2000).batons).toHaveLength(1)
    expect(deriveOfficeSnapshot(t0 + 25_000).batons).toHaveLength(0)
  })

  it("conv SEM items não gera bastão ao trocar de agent", () => {
    useChat.setState({ byId: { c1: conversa("p1", "claude-code") } })
    deriveOfficeSnapshot(t0)
    useChat.setState({ byId: { c1: conversa("p1", "codex") } })
    expect(deriveOfficeSnapshot(t0 + 1000).batons).toHaveLength(0)
  })
})

// ── arrivals (mesa off → disponível) ────────────────────────────────────────

describe("deriveOfficeSnapshot — arrivals", () => {
  const t0 = 9_000_000
  const probe = (installed: boolean) => ({
    installed,
    version: null,
    auth: "na" as const,
    detail: null,
    latest: null,
    checkedAt: 1,
  })

  it("off → disponível vira arrival (1º derive só memoriza; TTL 25s)", () => {
    setDetected({ codex: probe(false) })
    const first = deriveOfficeSnapshot(t0)
    expect(mesa(first, "p1", "codex").state).toBe("off")
    expect(first.arrivals).toHaveLength(0) // mesas já disponíveis não "chegam"

    setDetected({ codex: probe(true) })
    const snap = deriveOfficeSnapshot(t0 + 1000)
    expect(mesa(snap, "p1", "codex").state).not.toBe("off")
    expect(snap.arrivals).toEqual([{ deskId: "p1::codex", at: t0 + 1000 }])
    // dedupe + TTL
    expect(deriveOfficeSnapshot(t0 + 2000).arrivals).toHaveLength(1)
    expect(deriveOfficeSnapshot(t0 + 30_000).arrivals).toHaveLength(0)
  })
})

// ── bossDeliveries (courier até a mesa do Boss) ─────────────────────────────

describe("deriveOfficeSnapshot — bossDeliveries", () => {
  it("fim de turno gera bossDelivery junto com a delivery (TTL 30s > 15s)", () => {
    const t0 = 3_000_000
    useChat.setState({
      byId: { c1: conversa("p1", "claude-code", { running: true, runId: "r-1" }) },
    })
    deriveOfficeSnapshot(t0) // observa rodando

    useChat.setState({
      byId: {
        c1: conversa("p1", "claude-code", {
          running: false,
          items: [{ kind: "result", id: "res-1", ok: true, text: "Feito." }],
        }),
      },
    })
    const snap = deriveOfficeSnapshot(t0 + 1000)
    expect(snap.bossDeliveries).toEqual([
      { deskId: "p1::claude-code", convId: "c1", at: t0 + 1000 },
    ])
    // a delivery expira aos 15s; a entrega ao Boss vive até 30s
    const meio = deriveOfficeSnapshot(t0 + 18_000)
    expect(meio.deliveries).toHaveLength(0)
    expect(meio.bossDeliveries).toHaveLength(1)
    expect(deriveOfficeSnapshot(t0 + 35_000).bossDeliveries).toHaveLength(0)
  })
})

// ── startDeriving: coalescing + dedupe ──────────────────────────────────────

describe("startDeriving", () => {
  it("coalesce ≤10Hz (trailing edge) e dedupa snapshots estruturalmente iguais", async () => {
    vi.useFakeTimers()
    const vistos: OfficeSnapshot[] = []
    const stop = startDeriving((s) => vistos.push(s))

    // foto inicial imediata
    expect(vistos).toHaveLength(1)

    // mudanças que NÃO alteram o snapshot (drafts) ⇒ derive coalescido no
    // trailing edge, JSON igual ⇒ nenhum callback novo
    useChat.setState({ drafts: { c1: "rascunho" } })
    useChat.setState({ drafts: { c1: "rascunho maior" } })
    await vi.advanceTimersByTimeAsync(150)
    expect(vistos).toHaveLength(1)

    // rajada de mudanças REAIS ⇒ UM único snapshot no trailing edge
    useChat.setState({
      byId: { c1: conversa("p1", "claude-code", { running: true, runId: "r-1" }) },
    })
    useMission.setState({ byConv: {} }) // segunda mudança dentro da janela
    await vi.advanceTimersByTimeAsync(90)
    expect(vistos).toHaveLength(1) // ainda dentro da janela de coalescing
    await vi.advanceTimersByTimeAsync(60)
    expect(vistos).toHaveLength(2)
    expect(
      vistos[1].rooms[0].desks.find((d) => d.agent === "claude-code")?.state,
    ).toBe("thinking")

    // depois do stop, mudanças não emitem mais
    stop()
    useChat.setState({ byId: {} })
    await vi.advanceTimersByTimeAsync(500)
    expect(vistos).toHaveLength(2)
  })
})

// ── auth honesta (Sprint 0): estado-base da mesa nunca mente ────────────────

describe("deskBaseState — mapeamento estado→mesa", () => {
  it("ready acende a mesa como Disponível", () => {
    expect(deskBaseState("ready", false, null)).toEqual({
      state: "idle",
      label: "Disponível",
    })
  })

  it("auth incerta segue usável (degradação honesta, não bloqueio)", () => {
    expect(deskBaseState("installed-auth-unknown", false, null)).toEqual({
      state: "idle",
      label: "Disponível",
    })
  })

  it("CLI deslogada apaga a mesa com o motivo, nunca Disponível", () => {
    expect(deskBaseState("installed-not-authenticated", false, null)).toEqual({
      state: "off",
      label: "Instalado, sem login",
    })
  })

  it("não instalado e não integrado apagam como Não detectado", () => {
    expect(deskBaseState("missing", false, null).label).toBe("Não detectado")
    expect(deskBaseState("not-integrated", false, null).state).toBe("off")
  })

  it("rate limit bloqueia o posto com o hint de volta (sem hint, só o rótulo)", () => {
    expect(deskBaseState("ready", true, "~19h")).toEqual({
      state: "off",
      label: "Em rate limit",
      detail: "volta ~19h",
    })
    expect(deskBaseState("ready", true, null)).toEqual({
      state: "off",
      label: "Em rate limit",
      detail: undefined,
    })
  })

  it("deslogado vence rate limit (sem login nem dá pra atingir limite novo)", () => {
    expect(deskBaseState("installed-not-authenticated", true, "~19h").label).toBe(
      "Instalado, sem login",
    )
  })

  it("instrução por motivo de off acompanha o label (copy não diverge do motivo)", () => {
    expect(offInstruction(deskBaseState("installed-not-authenticated", false, null).label)).toBe(
      "Faça login pelo terminal da CLI.",
    )
    expect(offInstruction(deskBaseState("ready", true, "~19h").label)).toBe(
      "Aguarde a janela liberar.",
    )
    expect(offInstruction(deskBaseState("missing", false, null).label)).toBe(
      "Verifique nos Ajustes.",
    )
  })
})

describe("deriveOfficeSnapshot — auth honesta e rate limit na mesa", () => {
  const probeAuth = (auth: "ok" | "missing" | "unknown") => ({
    installed: true,
    version: "2.0.0",
    auth,
    detail: null,
    latest: null,
    checkedAt: 1,
  })

  it("CLI instalada e DESLOGADA ⇒ mesa apagada com 'Instalado, sem login'", () => {
    setDetected({ "claude-code": probeAuth("missing") })
    const desk = mesa(deriveOfficeSnapshot(), "p1", "claude-code")
    expect(desk.state).toBe("off")
    expect(desk.label).toBe("Instalado, sem login")
  })

  it("auth unknown (caso agy) ⇒ mesa segue Disponível", () => {
    setDetected({ agy: probeAuth("unknown") })
    const desk = mesa(deriveOfficeSnapshot(), "p1", "agy")
    expect(desk.state).toBe("idle")
    expect(desk.label).toBe("Disponível")
  })

  it("agent em rate limit ⇒ posto bloqueado com o reset_hint", () => {
    setDetected({ codex: probeAuth("ok") })
    useApp.setState({ limitedAgents: { codex: "~19h" } })
    const desk = mesa(deriveOfficeSnapshot(), "p1", "codex")
    expect(desk.state).toBe("off")
    expect(desk.label).toBe("Em rate limit")
    expect(desk.detail).toBe("volta ~19h")
  })

  it("rate limit curado (result ok limpa a marca) ⇒ mesa volta e gera arrival", () => {
    const t0 = 11_000_000
    useApp.setState({ limitedAgents: { codex: "~19h" } })
    expect(mesa(deriveOfficeSnapshot(t0), "p1", "codex").state).toBe("off")

    useApp.setState({ limitedAgents: {} })
    const snap = deriveOfficeSnapshot(t0 + 1000)
    expect(mesa(snap, "p1", "codex").label).toBe("Disponível")
    expect(snap.arrivals).toEqual([{ deskId: "p1::codex", at: t0 + 1000 }])
  })

  it("turno REALMENTE rodando vence o bloqueio (estado real, nunca teatro)", () => {
    // auto-resume/retry pode rodar com a marca ainda de pé: atividade real sobe
    // o estado da mesa — o rótulo de bloqueio não esconde trabalho de verdade.
    useApp.setState({ limitedAgents: { "claude-code": "~19h" } })
    useChat.setState({
      byId: { c1: conversa("p1", "claude-code", { running: true, runId: "r-1" }) },
    })
    const desk = mesa(deriveOfficeSnapshot(), "p1", "claude-code")
    expect(["thinking", "typing"]).toContain(desk.state)
  })
})
