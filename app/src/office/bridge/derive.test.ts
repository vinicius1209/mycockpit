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
import { useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"
import { _resetDeriveState, deriveOfficeSnapshot, startDeriving } from "./derive"

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
  useApp.setState({ projects: [projeto("p1")] })
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
    expect(snap.deliveries[0].text).toContain("Refatorei")
    // 15s depois o balão expira
    expect(deriveOfficeSnapshot(t0 + 20_000).deliveries).toHaveLength(0)
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
