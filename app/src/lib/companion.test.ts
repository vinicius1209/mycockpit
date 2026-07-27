// Testes da PONTE do Companion Web (lib/companion): snapshot construído dos
// stores REAIS (setState), executor com switch fechado roteando pro store
// certo (guardas intactas), ação desconhecida inócua e coalescing ≤2Hz com
// dedupe estrutural antes do invoke.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import type { Attachment } from "@/lib/attachments"
import type { MissionRun } from "@/lib/missionTypes"
import { feedbackLesson } from "@/lib/learning"
import { nativeNotify } from "@/lib/notify"
import { cancelDeskTurn, ensureDeskConversation, sendFromDesk } from "@/office/bridge/send"
import { useApp } from "@/store/app"
import { useCards, type CardRow } from "@/store/cards"
import { useChat, type ConvState } from "@/store/chat"
import { useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"
import {
  buildCompanionSnapshot,
  handleCompanionAction,
  startCompanionBridge,
  stopCompanionBridge,
} from "./companion"

// Ponte do Tauri mocada (o módulo empurra via invoke e escuta via listen).
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }))
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}))
// isTauri true liga o caminho real do push; loadLedger/listRecentDeliveries
// mocados (o cache de extras não deve bater em DB nos testes).
vi.mock("@/lib/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db")>()
  return {
    ...mod,
    isTauri: () => true,
    loadLedger: vi.fn(async () => []),
    listRecentDeliveries: vi.fn(async () => []),
    // hidratação de boot do useCards (side-effect do import) não bate em DB
    listCards: vi.fn(async () => []),
  }
})
// Aviso nativo (caminho de erro de ação de card SEM conversa) mocado.
vi.mock("@/lib/notify", () => ({ nativeNotify: vi.fn(async () => {}) }))
// O envio da mesa é testado em send.test.ts — aqui só o ROTEAMENTO.
vi.mock("@/office/bridge/send", () => ({
  DESK_TITLE_PREFIX: "Mesa · ",
  ensureDeskConversation: vi.fn(async () => "conv-mesa"),
  sendFromDesk: vi.fn(async () => {}),
  cancelDeskTurn: vi.fn(async () => {}),
}))
// O reforço real (registro + reinforceLessons) é testado em learning.test.ts.
vi.mock("@/lib/learning", () => ({ feedbackLesson: vi.fn(async () => {}) }))

function makeConv(partial: Partial<ConvState> = {}): ConvState {
  return {
    projectId: "p1",
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
    ...partial,
  }
}

function makeMission(partial: Partial<MissionRun> = {}): MissionRun {
  return {
    id: "m1",
    convId: "c2",
    presetName: "Feature completa",
    dir: ".mycockpit/missions/test",
    task: "implementar o parser",
    phases: [
      {
        def: {
          id: "plan",
          label: "Planejar",
          persona: "planner",
          agent: "claude-code",
          model: "opus",
          effort: null,
          maxRetries: 1,
        },
        status: "done",
        attempt: 1,
        costUsd: 1.5,
        startedAt: 10,
      },
      {
        def: {
          id: "build",
          label: "Executar",
          persona: "executor",
          agent: "codex",
          model: null,
          effort: null,
          maxRetries: 2,
        },
        status: "running",
        attempt: 1,
        costUsd: 0,
        startedAt: 20,
      },
    ],
    current: 1,
    costTotal: 1.5,
    maxCostUsd: 25,
    status: "running",
    startedAt: 5,
    ...partial,
  }
}

const att: Attachment = {
  path: "attachments/c2/abc.png",
  name: "foto.png",
  kind: "image",
  mime: "image/png",
  bytes: 123,
}

function makeCard(partial: Partial<CardRow> & { id: string }): CardRow {
  return {
    projectId: "p1",
    title: `Card ${partial.id}`,
    body: null,
    state: "backlog",
    assigneeAgent: null,
    conversationId: null,
    owner: null,
    pinned: false,
    pinRank: null,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...partial,
  }
}

// ações REAIS do store de cards (restauradas no beforeEach — testes que mocam
// dispatch/closeCard via setState não vazam pros vizinhos)
const cardsOriginal = {
  dispatch: useCards.getState().dispatch,
  closeCard: useCards.getState().closeCard,
}

beforeEach(() => {
  vi.clearAllMocks()
  stopCompanionBridge()
  useApp.setState({
    projects: [
      { id: "p1", name: "alpha", path: "/proj/alpha", createdAt: 1 },
      { id: "p2", name: "beta", path: "/proj/beta", createdAt: 2 },
    ],
  })
  useChat.setState({
    byId: {},
    conversationsByProject: {},
    conversations: [],
    projectId: null,
    activeId: null,
  })
  useMission.setState({ byConv: {} })
  useInteractions.setState({ queue: [] })
  useCards.setState({
    all: [],
    byProject: {},
    loaded: true,
    selectedId: null,
    dispatch: cardsOriginal.dispatch,
    closeCard: cardsOriginal.closeCard,
  })
})

afterEach(() => {
  stopCompanionBridge()
  vi.useRealTimers()
})

// ------------------------------------------------------------------- snapshot

describe("buildCompanionSnapshot", () => {
  it("monta atenção (gate + approval mapeada + question), execução e missões", () => {
    useChat.setState({
      byId: {
        c1: makeConv({ running: true, runId: "run-1", startedAt: 111 }),
        c2: makeConv({ projectId: "p2" }),
      },
      conversationsByProject: {
        p1: [
          {
            id: "c1",
            title: "refatorar o parser",
            updatedAt: 1,
            color: null,
            worktreePath: null,
            agent: "claude-code",
          },
        ],
      },
    })
    useMission.setState({
      byConv: {
        c2: makeMission({
          gate: { phase: 0, questions: ["Qual banco usar?"] },
        }),
      },
    })
    useInteractions.setState({
      queue: [
        {
          id: "i1",
          kind: "approval",
          data: { run_id: "run-1", tool_name: "Bash", command: "rm -rf dist", input: {} },
        },
        {
          // run_id NA PERGUNTA, como o backend realmente emite (approval.rs
          // anexa em toda emissão, sem ramificar por kind). A fixture antiga
          // omitia o campo, e por isso a suíte "provava" que pergunta chega ao
          // celular sem conversa — provando só que o fixture era irreal.
          id: "q1",
          run_id: "run-1",
          kind: "question",
          data: {
            questions: [
              { header: "Lib", question: "Qual lib usar?", multiSelect: false, options: [] },
            ],
          },
        },
      ],
    })

    const snap = buildCompanionSnapshot({
      ledger: [
        { agent: "claude-code", projectId: "p1", costUsd: 2, tokens: 10, createdAt: 1 },
      ],
      deliveries: [
        {
          id: "d1",
          projectId: "p1",
          task: "entrega antiga",
          planSummary: "",
          filesTouched: [],
          costUsd: 3,
          agent: "codex",
          model: null,
          createdAt: 99,
        },
      ],
    })

    // atenção: gate da missão + approval e question ambas mapeadas pelo run_id
    expect(snap.attention.map((a) => a.kind)).toEqual([
      "gate",
      "approval",
      "question",
    ])
    const [gate, approval, question] = snap.attention
    expect(gate).toMatchObject({
      id: "gate:c2",
      convId: "c2",
      projectId: "p2",
      projectName: "beta",
      agent: "claude-code", // agent da fase do gate
      phase: 0,
      phaseLabel: "Planejar",
      questions: ["Qual banco usar?"],
    })
    expect(approval).toMatchObject({
      id: "i1",
      convId: "c1",
      projectId: "p1",
      projectName: "alpha",
      agent: "claude-code",
      command: "rm -rf dist",
      toolName: "Bash",
      phase: null,
    })
    // pergunta chega COM origem: sem conversa/projeto/agent, o item no celular
    // não te diz se vale voltar pro computador. O builder resolvia o alvo uma
    // vez com a régua approval-only e reusava aqui, onde ela devolve null.
    expect(question).toMatchObject({
      id: "q1",
      convId: "c1",
      projectId: "p1",
      projectName: "alpha",
      agent: "claude-code",
      questions: ["Qual lib usar?"],
    })

    // execução: turno linear + missão rodando (com resumo das fases)
    expect(snap.running).toHaveLength(2)
    const turno = snap.running.find((r) => r.kind === "turno")
    expect(turno).toMatchObject({
      convId: "c1",
      projectId: "p1",
      projectName: "alpha",
      agent: "claude-code",
      label: "refatorar o parser",
      detail: "Analisando a tarefa…",
      startedAt: 111,
    })
    const missao = snap.running.find((r) => r.kind === "missão")
    expect(missao).toMatchObject({
      convId: "c2",
      agent: "codex", // agent da fase corrente
      label: "implementar o parser",
      detail: "Executar…",
      missionPhases: [
        { label: "Planejar", status: "done" },
        { label: "Executar", status: "running" },
      ],
    })

    // missões: fases com label/agent/status/custo + gate + teto
    expect(snap.missions).toEqual([
      expect.objectContaining({
        convId: "c2",
        projectId: "p2",
        task: "implementar o parser",
        status: "running",
        current: 1,
        costTotal: 1.5,
        maxCostUsd: 25,
        gate: { phase: 0, questions: ["Qual banco usar?"] },
        phases: [
          { label: "Planejar", agent: "claude-code", status: "done", costUsd: 1.5 },
          { label: "Executar", agent: "codex", status: "running", costUsd: 0 },
        ],
      }),
    ])

    // custos: ledger de hoje + missão VIVA (não-done, fora do ledger)
    expect(snap.costs.totalUsd).toBeCloseTo(3.5)
    expect(snap.costs.byProject).toEqual({ p1: 2, p2: 1.5 })

    // entregas + projetos com agents utilizáveis
    expect(snap.deliveries).toEqual([
      expect.objectContaining({
        projectId: "p1",
        projectName: "alpha",
        task: "entrega antiga",
        agent: "codex",
        costUsd: 3,
      }),
    ])
    expect(snap.projects).toEqual([
      {
        id: "p1",
        name: "alpha",
        agents: [{ agent: "claude-code" }, { agent: "codex" }, { agent: "agy" }],
      },
      {
        id: "p2",
        name: "beta",
        agents: [{ agent: "claude-code" }, { agent: "codex" }, { agent: "agy" }],
      },
    ])
  })

  it("expõe a conversa de MESA de cada agent (deskConvId — histórico no celular)", () => {
    useChat.setState({
      conversationsByProject: {
        p1: [
          // conversa do usuário com o MESMO agent: nunca vira mesa
          { id: "u1", title: "refatorar parser", updatedAt: 50, color: null, worktreePath: null, agent: "claude-code" },
          // duas mesas do claude-code → vence a mais RECENTE (updatedAt)
          { id: "d-old", title: "Mesa · Claude Code", updatedAt: 10, color: null, worktreePath: null, agent: "claude-code" },
          { id: "d-new", title: "Mesa · Claude Code", updatedAt: 99, color: null, worktreePath: null, agent: "claude-code" },
          // título de mesa com agent DIVERGENTE: não é a mesa do codex? é sim —
          // a regra é meta.agent (o título é só o prefixo), igual ao ensure
          { id: "d-cx", title: "Mesa · Codex", updatedAt: 20, color: null, worktreePath: null, agent: "codex" },
        ],
      },
    })
    const snap = buildCompanionSnapshot()
    const p1 = snap.projects.find((p) => p.id === "p1")
    expect(p1?.agents).toEqual([
      { agent: "claude-code", deskConvId: "d-new", deskTitle: "Mesa · Claude Code" },
      { agent: "codex", deskConvId: "d-cx", deskTitle: "Mesa · Codex" },
      { agent: "agy" },
    ])
    // p2 sem metas carregadas → agents sem mesa (a ponte carrega lazy depois)
    const p2 = snap.projects.find((p) => p.id === "p2")
    expect(p2?.agents.every((a) => a.deskConvId === undefined)).toBe(true)
  })

  it("missão done NÃO soma no custo de novo (já virou delivery no ledger)", () => {
    useChat.setState({ byId: { c2: makeConv({ projectId: "p2" }) } })
    useMission.setState({
      byConv: { c2: makeMission({ status: "done", costTotal: 9 }) },
    })
    const snap = buildCompanionSnapshot({
      ledger: [
        { agent: "codex", projectId: "p2", costUsd: 9, tokens: 0, createdAt: 1 },
      ],
      deliveries: [],
    })
    expect(snap.costs.totalUsd).toBe(9)
    expect(snap.running).toHaveLength(0)
    expect(snap.missions[0].status).toBe("done")
  })
})

// -------------------------------------------------------------------- executor

describe("handleCompanionAction — switch fechado", () => {
  it("answer_gate roteia pro useMission.answerGate com respostas ricas saneadas", async () => {
    const answerGate = vi.fn()
    useMission.setState({ answerGate })
    await handleCompanionAction({
      kind: "answer_gate",
      convId: "c2",
      answers: [
        { text: "Postgres", attachments: [att] },
        { text: "" },
        // anexo com path fora do cache é DESCARTADO (nunca path arbitrário)
        { text: "x", attachments: [{ ...att, path: "/etc/passwd" }] },
      ],
    })
    expect(answerGate).toHaveBeenCalledWith("c2", [
      { text: "Postgres", attachments: [att] },
      { text: "", attachments: undefined },
      { text: "x", attachments: undefined },
    ])
  })

  it("answer_interaction roteia pro useInteractions.answer (fila única)", async () => {
    const answer = vi.fn()
    useInteractions.setState({ answer })
    await handleCompanionAction({
      kind: "answer_interaction",
      id: "i1",
      answer: { allow: false, message: "negado do celular" },
    })
    expect(answer).toHaveBeenCalledWith("i1", {
      allow: false,
      message: "negado do celular",
    })
  })

  it("stop_mission → useMission.abort · stop_turn → cancelDeskTurn", async () => {
    const abort = vi.fn()
    useMission.setState({ abort })
    await handleCompanionAction({ kind: "stop_mission", convId: "c2" })
    expect(abort).toHaveBeenCalledWith("c2")
    await handleCompanionAction({ kind: "stop_turn", convId: "c1" })
    expect(cancelDeskTurn).toHaveBeenCalledWith("c1")
  })

  it("send_message garante a conversa da mesa e envia pelo sendFromDesk", async () => {
    await handleCompanionAction({
      kind: "send_message",
      projectId: "p1",
      agent: "codex",
      text: "roda os testes",
      attachments: [att],
    })
    expect(ensureDeskConversation).toHaveBeenCalledWith("p1", "codex")
    expect(sendFromDesk).toHaveBeenCalledWith({
      convId: "conv-mesa",
      projectId: "p1",
      projectPath: "/proj/alpha",
      agent: "codex",
      text: "roda os testes",
      attachments: [att],
    })
  })

  it("send_message com convId das metas do projeto envia DIRETO nessa conversa (P5)", async () => {
    useChat.setState({
      conversationsByProject: {
        p1: [
          { id: "c9", title: "refatorar parser", updatedAt: 1, color: null, worktreePath: null, agent: "claude-code" },
        ],
      },
      // D3 resolve o agent efetivo do alvo explícito lendo byId — seed evita
      // o ensureConversationLoaded real bater no SQLite dentro do teste.
      byId: { c9: makeConv({ agent: "claude-code" }) },
    })
    await handleCompanionAction({
      kind: "send_message",
      projectId: "p1",
      agent: "codex",
      text: "continua",
      convId: "c9",
    })
    // alvo explícito válido: NÃO resolve mesa; o agent travado da conversa
    // vence o da ação dentro do sendFromDesk (guarda existente)
    expect(ensureDeskConversation).not.toHaveBeenCalled()
    expect(sendFromDesk).toHaveBeenCalledWith(
      expect.objectContaining({ convId: "c9", projectId: "p1", agent: "codex" }),
    )
  })

  it("send_message com convId fora das metas do projeto cai na conversa de MESA", async () => {
    useChat.setState({
      conversationsByProject: {
        p1: [
          { id: "c9", title: "x", updatedAt: 1, color: null, worktreePath: null, agent: "claude-code" },
        ],
      },
    })
    await handleCompanionAction({
      kind: "send_message",
      projectId: "p1",
      agent: "codex",
      text: "oi",
      convId: "fantasma",
    })
    expect(ensureDeskConversation).toHaveBeenCalledWith("p1", "codex")
    expect(sendFromDesk).toHaveBeenCalledWith(
      expect.objectContaining({ convId: "conv-mesa" }),
    )
  })

  it("F-A: send_message pra CLI deslogada NÃO despacha; o motivo volta pro celular como notice na conversa", async () => {
    const settings = useApp.getState().settings
    useApp.setState({
      settings: {
        ...settings,
        detected: {
          codex: {
            installed: true,
            version: "1.0.0",
            auth: "missing",
            detail: null,
            latest: null,
            checkedAt: 0,
          },
        },
      },
    })
    // conversa da mesa já carregada (ensureDeskConversation mocado devolve
    // "conv-mesa"); persist stubado — o envelope aqui é o item na conversa.
    const persistOriginal = useChat.getState().persist
    const persist = vi.fn(async () => {})
    useChat.setState({
      byId: { "conv-mesa": makeConv({ agent: "codex" }) },
      persist,
    })
    try {
      await handleCompanionAction({
        kind: "send_message",
        projectId: "p1",
        agent: "codex",
        text: "roda os testes",
      })
      expect(sendFromDesk).not.toHaveBeenCalled()
      const items = useChat.getState().byId["conv-mesa"].items
      const notice = items.find((it) => it.kind === "notice")
      expect(notice && notice.kind === "notice" ? notice.message : "").toContain(
        "sem login",
      )
      // persistido: o GET /api/conv do celular lê o SQLite e vê o motivo.
      expect(persist).toHaveBeenCalledWith("conv-mesa")
    } finally {
      useChat.setState({ persist: persistOriginal })
      useApp.setState({ settings })
    }
  })

  it("D1: o ping de conversa só sai DEPOIS do persist commitar (ordem, não só chamada)", async () => {
    vi.useFakeTimers()
    const settings = useApp.getState().settings
    useApp.setState({
      settings: {
        ...settings,
        detected: {
          codex: {
            installed: true,
            version: "1.0.0",
            auth: "missing",
            detail: null,
            latest: null,
            checkedAt: 0,
          },
        },
      },
    })
    // persist DEFERIDO: só resolve quando o teste soltar — se o código não
    // esperar o commit, o ping dispara antes e a asserção pega.
    let release!: () => void
    const persistOriginal = useChat.getState().persist
    const persist = vi.fn(
      () =>
        new Promise<void>((r) => {
          release = r
        }),
    )
    useChat.setState({
      byId: { "conv-mesa": makeConv({ agent: "codex" }) },
      persist,
    })
    try {
      const acted = handleCompanionAction({
        kind: "send_message",
        projectId: "p1",
        agent: "codex",
        text: "oi",
      })
      // persist pendente: mesmo com o relógio andando, NENHUM ping sai.
      await vi.advanceTimersByTimeAsync(2_000)
      expect(persist).toHaveBeenCalledWith("conv-mesa")
      expect(invoke).not.toHaveBeenCalledWith("companion_conv_updated", {
        convId: "conv-mesa",
      })
      // persist commitou → agora sim o ping (o refetch verá o notice).
      release()
      await acted
      await vi.advanceTimersByTimeAsync(2_000)
      expect(invoke).toHaveBeenCalledWith("companion_conv_updated", {
        convId: "conv-mesa",
      })
    } finally {
      useChat.setState({ persist: persistOriginal })
      useApp.setState({ settings })
      vi.useRealTimers()
    }
  })

  it("D3: convId explícito com agent TRAVADO deslogado bloqueia, mesmo com a mesa da ação saudável", async () => {
    const settings = useApp.getState().settings
    useApp.setState({
      settings: {
        ...settings,
        detected: {
          codex: {
            installed: true,
            version: "1.0.0",
            auth: "missing",
            detail: null,
            latest: null,
            checkedAt: 0,
          },
          "claude-code": {
            installed: true,
            version: "1.0.0",
            auth: "ok",
            detail: null,
            latest: null,
            checkedAt: 0,
          },
        },
      },
    })
    const persistOriginal = useChat.getState().persist
    const persist = vi.fn(async () => {})
    useChat.setState({
      conversationsByProject: {
        p1: [
          { id: "c9", title: "antiga", updatedAt: 1, color: null, worktreePath: null, agent: "codex" },
        ],
      },
      // conversa TRAVADA no codex (items não-vazios): o agent dela vence o
      // "claude-code" da ação — e o codex está deslogado.
      byId: {
        c9: makeConv({
          agent: "codex",
          items: [{ kind: "user", id: "u1", text: "antes" }],
        }),
      },
      persist,
    })
    try {
      await handleCompanionAction({
        kind: "send_message",
        projectId: "p1",
        agent: "claude-code",
        text: "continua",
        convId: "c9",
      })
      expect(sendFromDesk).not.toHaveBeenCalled()
      const items = useChat.getState().byId.c9.items
      const notice = items.find((it) => it.kind === "notice")
      expect(
        notice && notice.kind === "notice" ? notice.message : "",
      ).toContain("Codex")
      expect(persist).toHaveBeenCalledWith("c9")
    } finally {
      useChat.setState({ persist: persistOriginal })
      useApp.setState({ settings })
    }
  })

  it("F-A: send_message com auth incerta SEGUE despachando (degradação honesta)", async () => {
    const settings = useApp.getState().settings
    useApp.setState({
      settings: {
        ...settings,
        detected: {
          codex: {
            installed: true,
            version: "1.0.0",
            auth: "unknown",
            detail: null,
            latest: null,
            checkedAt: 0,
          },
        },
      },
    })
    try {
      await handleCompanionAction({
        kind: "send_message",
        projectId: "p1",
        agent: "codex",
        text: "segue o jogo",
      })
      expect(sendFromDesk).toHaveBeenCalledWith(
        expect.objectContaining({ convId: "conv-mesa", agent: "codex" }),
      )
    } finally {
      useApp.setState({ settings })
    }
  })

  it("feedback_lesson roteia pro MESMO caminho do 👍 (feedbackLesson)", async () => {
    await handleCompanionAction({ kind: "feedback_lesson", convId: "c1", verdict: "up" })
    expect(feedbackLesson).toHaveBeenCalledWith("c1", "up")
    await handleCompanionAction({ kind: "feedback_lesson", convId: "c1", verdict: "down" })
    expect(feedbackLesson).toHaveBeenCalledWith("c1", "down")
  })

  it("feedback_lesson malformado (verdict fora do enum / sem convId) é inócuo", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await handleCompanionAction({ kind: "feedback_lesson", convId: "c1", verdict: "meh" })
    await handleCompanionAction({ kind: "feedback_lesson", verdict: "up" })
    expect(feedbackLesson).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it("send_message com agent fora da whitelist ou projeto desconhecido é ignorado", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await handleCompanionAction({
      kind: "send_message",
      projectId: "p1",
      agent: "rm-rf",
      text: "oi",
    })
    await handleCompanionAction({
      kind: "send_message",
      projectId: "p-fantasma",
      agent: "codex",
      text: "oi",
    })
    expect(ensureDeskConversation).not.toHaveBeenCalled()
    expect(sendFromDesk).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it("anexos do Rust (mapa id→Attachment + attachmentIds) são resolvidos na ordem do celular", async () => {
    const att2: Attachment = {
      path: "attachments/c2/def.pdf",
      name: "doc.pdf",
      kind: "pdf",
      mime: "application/pdf",
      bytes: 456,
    }
    await handleCompanionAction({
      kind: "send_message",
      projectId: "p1",
      agent: "codex",
      text: "olha os anexos",
      attachmentIds: ["b", "a"],
      attachments: { a: att, b: att2 },
    })
    expect(sendFromDesk).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: [att2, att] }),
    )
  })

  it("answer_gate com uploads do celular anexa à PRIMEIRA resposta", async () => {
    const answerGate = vi.fn()
    useMission.setState({ answerGate })
    await handleCompanionAction({
      kind: "answer_gate",
      convId: "c2",
      answers: [{ text: "Postgres" }, { text: "sim" }],
      attachmentIds: ["u1"],
      attachments: { u1: att },
    })
    expect(answerGate).toHaveBeenCalledWith("c2", [
      { text: "Postgres", attachments: [att] },
      { text: "sim", attachments: undefined },
    ])
  })

  it("ação desconhecida (ou payload torto) é inócua: só console.warn", async () => {
    const abort = vi.fn()
    const answerGate = vi.fn()
    useMission.setState({ abort, answerGate })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await handleCompanionAction({ kind: "format_disk", convId: "c1" })
    await handleCompanionAction(null)
    await handleCompanionAction({ kind: "answer_gate", convId: "c1" }) // sem answers
    expect(abort).not.toHaveBeenCalled()
    expect(answerGate).not.toHaveBeenCalled()
    expect(sendFromDesk).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })
})

// ------------------------------------------------------- board (S4.5 + S4.6)

describe("board no companion — snapshot e ações remotas", () => {
  it("snapshot expõe os cards ABERTOS do board (terminal fora) e nunca inventa custo", () => {
    useCards.setState({
      all: [
        makeCard({ id: "k1", state: "backlog" }),
        makeCard({ id: "k2", state: "working", projectId: "p2" }),
        makeCard({ id: "k3", state: "review" }),
        makeCard({ id: "k4", state: "done" }),
        makeCard({ id: "k5", state: "cancelled" }),
      ],
    })
    const snap = buildCompanionSnapshot()
    expect(snap.cards).toEqual([
      { id: "k1", projectId: "p1", projectName: "alpha", title: "Card k1", state: "backlog" },
      { id: "k2", projectId: "p2", projectName: "beta", title: "Card k2", state: "working" },
      { id: "k3", projectId: "p1", projectName: "alpha", title: "Card k3", state: "review" },
    ])
    // custo por card mora em turn_costs (query do Painel), não no store:
    // o snapshot OMITE o campo em vez de inventar zero.
    expect(snap.cards?.every((c) => !("costUsd" in c))).toBe(true)
  })

  it("card estagnado entra TAMBÉM em attention com kind card, título e minutes", () => {
    useCards.setState({
      all: [
        makeCard({
          id: "k9",
          state: "working",
          conversationId: "c-k9",
          assigneeAgent: "codex",
          stalledSince: Date.now() - 5 * 60_000,
        }),
        makeCard({ id: "k1", state: "backlog" }), // sem estagnação: só no board
      ],
    })
    const snap = buildCompanionSnapshot()
    const cardsAttn = snap.attention.filter((a) => a.kind === "card")
    expect(cardsAttn).toHaveLength(1)
    expect(cardsAttn[0]).toMatchObject({
      id: "card:k9",
      convId: "c-k9",
      projectId: "p1",
      projectName: "alpha",
      agent: "codex",
      title: "Card k9",
      minutes: 5,
    })
    // o card segue na seção Board com o stalledSince cru (a página rotula)
    expect(snap.cards?.find((c) => c.id === "k9")).toMatchObject({
      stalledSince: expect.any(Number),
    })
  })

  it("dispatch_card roteia pro useCards.dispatch (o celular é o humano; guardas do store intactas)", async () => {
    const dispatch = vi.fn(async () => "conv-nova")
    useCards.setState({ dispatch })
    await handleCompanionAction({ kind: "dispatch_card", cardId: "k1" })
    expect(dispatch).toHaveBeenCalledWith("k1")
  })

  it("B1: dispatch_card de card em projeto ARQUIVADO bate na guarda do store e é reportado", async () => {
    // dispatch REAL do store: a guarda de projeto arquivado mora lá, não na UI
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    useCards.setState({
      all: [makeCard({ id: "k1", state: "backlog", projectId: "p-arquivado" })],
    })
    await handleCompanionAction({ kind: "dispatch_card", cardId: "k1" })
    // nada despachou e o motivo chegou ao caminho de erro (card sem conversa
    // → aviso nativo no desktop, gap documentado)
    expect(useCards.getState().all[0].state).toBe("backlog")
    expect(nativeNotify).toHaveBeenCalledWith(
      "Companion",
      expect.stringContaining("Projeto arquivado"),
    )
    warn.mockRestore()
  })

  it("D1: dispatch_card de card INEXISTENTE (snapshot stale) lança no store e é reportado", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await handleCompanionAction({ kind: "dispatch_card", cardId: "k-stale" })
    expect(nativeNotify).toHaveBeenCalledWith(
      "Companion",
      expect.stringContaining("Card não encontrado no board"),
    )
    warn.mockRestore()
  })

  it("D2: card de projeto arquivado viaja com archived: true (a página rotula e esconde Iniciar)", () => {
    useCards.setState({
      all: [
        makeCard({ id: "k1", state: "backlog", projectId: "p-arquivado" }),
        makeCard({ id: "k2", state: "backlog" }),
      ],
    })
    const snap = buildCompanionSnapshot()
    expect(snap.cards?.find((c) => c.id === "k1")).toMatchObject({
      projectName: null,
      archived: true,
    })
    // projeto vivo NÃO carrega a marca
    expect("archived" in (snap.cards?.find((c) => c.id === "k2") ?? {})).toBe(false)
  })

  it("close_card valida o enum done|cancelled também no front; malformado é inócuo", async () => {
    const closeCard = vi.fn(async () => {})
    const dispatch = vi.fn(async () => null)
    useCards.setState({ closeCard, dispatch })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await handleCompanionAction({ kind: "close_card", cardId: "k1", state: "done" })
    expect(closeCard).toHaveBeenCalledWith("k1", "done")
    await handleCompanionAction({ kind: "close_card", cardId: "k1", state: "cancelled" })
    expect(closeCard).toHaveBeenCalledWith("k1", "cancelled")
    // fora do enum / sem cardId: nada roda, só aviso
    await handleCompanionAction({ kind: "close_card", cardId: "k1", state: "working" })
    await handleCompanionAction({ kind: "close_card", state: "done" })
    await handleCompanionAction({ kind: "dispatch_card" })
    expect(closeCard).toHaveBeenCalledTimes(2)
    expect(dispatch).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })

  it("erro de guarda num card COM conversa volta como notice persistido (envelope do send_message)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const dispatch = vi.fn(async () => {
      throw new Error("Só um card no backlog pode ser iniciado")
    })
    useCards.setState({
      all: [makeCard({ id: "k1", state: "working", conversationId: "c-card" })],
      dispatch,
    })
    const persistOriginal = useChat.getState().persist
    const persist = vi.fn(async () => {})
    useChat.setState({ byId: { "c-card": makeConv() }, persist })
    try {
      await handleCompanionAction({ kind: "dispatch_card", cardId: "k1" })
      const items = useChat.getState().byId["c-card"].items
      const notice = items.find((it) => it.kind === "notice")
      expect(
        notice && notice.kind === "notice" ? notice.message : "",
      ).toContain("backlog")
      // persistido: o refetch do celular lê o SQLite e vê o motivo
      expect(persist).toHaveBeenCalledWith("c-card")
      expect(nativeNotify).not.toHaveBeenCalled()
    } finally {
      useChat.setState({ persist: persistOriginal })
      warn.mockRestore()
    }
  })

  it("erro num card SEM conversa: gap honesto — console.warn + aviso nativo no desktop", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const closeCard = vi.fn(async () => {
      throw new Error("transição de card inválida: working → done")
    })
    useCards.setState({
      all: [makeCard({ id: "k1", state: "working" })],
      closeCard,
    })
    await handleCompanionAction({ kind: "close_card", cardId: "k1", state: "done" })
    expect(warn).toHaveBeenCalled()
    expect(nativeNotify).toHaveBeenCalledWith(
      "Companion",
      expect.stringContaining("transição de card inválida"),
    )
    warn.mockRestore()
  })

  it("mutação no useCards re-empurra o snapshot (a ponte assina o store de cards)", async () => {
    vi.useFakeTimers()
    startCompanionBridge()
    await vi.advanceTimersByTimeAsync(600)
    const pushes = () =>
      vi
        .mocked(invoke)
        .mock.calls.filter(([cmd]) => cmd === "set_companion_snapshot").length
    const base = pushes()
    useCards.setState({ all: [makeCard({ id: "k1" })], byProject: {} })
    await vi.advanceTimersByTimeAsync(600)
    expect(pushes()).toBe(base + 1)
  })
})

// ------------------------------------------------------------------ coalescing

describe("startCompanionBridge — push coalescido", () => {
  it("rajada de mudanças vira UM invoke; sem mudança estrutural não re-empurra", async () => {
    vi.useFakeTimers()
    startCompanionBridge()
    // rajada: várias mudanças dentro da janela de 500ms
    useChat.setState({ byId: { c1: makeConv({ running: true }) } })
    useChat.setState({
      byId: { c1: makeConv({ running: true, startedAt: 42 }) },
    })
    await vi.advanceTimersByTimeAsync(600)
    const pushes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "set_companion_snapshot")
    expect(pushes).toHaveLength(1)
    // set SEM mudança estrutural do payload → dedupe segura o invoke
    useChat.setState({
      byId: { c1: makeConv({ running: true, startedAt: 42 }) },
    })
    await vi.advanceTimersByTimeAsync(600)
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([cmd]) => cmd === "set_companion_snapshot"),
    ).toHaveLength(1)
    // mudança REAL → novo push
    useMission.setState({ byConv: { c1: makeMission({ convId: "c1" }) } })
    await vi.advanceTimersByTimeAsync(600)
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([cmd]) => cmd === "set_companion_snapshot"),
    ).toHaveLength(2)
  })

  it("conversa com turno vivo pinga companion_conv_updated (throttle 1s)", async () => {
    vi.useFakeTimers()
    startCompanionBridge()
    useChat.setState({ byId: { c1: makeConv({ running: true }) } })
    // rajada de deltas na mesma conversa: só UM ping na janela
    useChat.setState({
      byId: { c1: makeConv({ running: true, contextTokens: 10 }) },
    })
    useChat.setState({
      byId: { c1: makeConv({ running: true, contextTokens: 20 }) },
    })
    await vi.advanceTimersByTimeAsync(1100)
    const pings = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "companion_conv_updated")
    expect(pings).toHaveLength(1)
    expect(pings[0][1]).toEqual({ convId: "c1" })
    // conversa PARADA não pinga
    useChat.setState({ byId: { c1: makeConv({ running: false }) } })
    useChat.setState({
      byId: { c1: makeConv({ running: false, contextTokens: 30 }) },
    })
    await vi.advanceTimersByTimeAsync(1500)
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([cmd]) => cmd === "companion_conv_updated"),
    ).toHaveLength(1)
  })
})
