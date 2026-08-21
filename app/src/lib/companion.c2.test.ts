// C2 — Ações do Companion (docs/companion-plan.md): lançar tarefa pelo MESMO
// caminho do composer (registerConversation → preset → sendFromDesk), snapshot
// com finalizing/choices/specialists e o veredito honesto (action-result) das
// paradas. Arquivo separado do companion.test.ts de propósito: os mocks de C2
// (agentDefs, ações do useChat) não podem contaminar a suíte C1.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { getAgentDef } from "@/lib/agentDefs"
import type { MissionRun } from "@/lib/missionTypes"
import { cancelDeskTurn, sendFromDesk } from "@/lib/fleet/send"
import { useApp } from "@/store/app"
import { useChat, type ConvState } from "@/store/chat"
import { useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"
import { usePresets } from "@/store/presets"
import type { AgentDef } from "@/lib/agentDefs"
import { buildCompanionSnapshot } from "./companion"
import { handleCompanionAction } from "./companionAction"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }))
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}))
vi.mock("@/lib/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db")>()
  return {
    ...mod,
    isTauri: () => true,
    loadLedger: vi.fn(async () => []),
    listRecentDeliveries: vi.fn(async () => []),
    listCards: vi.fn(async () => []),
  }
})
vi.mock("@/lib/notify", () => ({ nativeNotify: vi.fn(async () => {}) }))
vi.mock("@/lib/fleet/send", () => ({
  DESK_TITLE_PREFIX: "Mesa · ",
  ensureDeskConversation: vi.fn(async () => "conv-mesa"),
  sendFromDesk: vi.fn(async () => {}),
  cancelDeskTurn: vi.fn(async () => {}),
}))
vi.mock("@/lib/learning", () => ({ feedbackLesson: vi.fn(async () => {}) }))
// Especialista lido do disco no lançamento: mocado por teste (fail-closed é
// exatamente o que está em prova aqui).
vi.mock("@/lib/agentDefs", () => ({ getAgentDef: vi.fn(async () => null) }))

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
    phases: [],
    current: 0,
    costTotal: 0,
    maxCostUsd: null,
    status: "running",
    startedAt: 5,
    ...partial,
  }
}

/** Persona de fixture com o shape REAL do AgentDef (arquivo .mycockpit/agents). */
function makeSpecialist(partial: Partial<AgentDef> & { id: string }): AgentDef {
  return {
    name: partial.id,
    personalityMd: "Você revisa com rigor.",
    skills: [],
    policy: null,
    backend: "claude-code",
    model: null,
    effort: null,
    category: "Geral",
    rubric: [],
    avatarStyle: "thumbs",
    avatarSeed: partial.id,
    digest: "d".repeat(64),
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    scope: "global",
    slug: partial.id,
    path: `/na/ui/${partial.id}.md`,
    ...partial,
  }
}

/** Chamadas de companion_action_result registradas no invoke mocado. */
function actionResults(): Record<string, unknown>[] {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "companion_action_result")
    .map(([, args]) => (args as { result: Record<string, unknown> }).result)
}

const chatOriginal = {
  registerConversation: useChat.getState().registerConversation,
  ensureConversationLoaded: useChat.getState().ensureConversationLoaded,
  setConversationPreset: useChat.getState().setConversationPreset,
}

const AID = "aabbccddeeff00112233445566778899"

beforeEach(() => {
  vi.clearAllMocks()
  useApp.setState({
    projects: [{ id: "p1", name: "alpha", path: "/proj/alpha", createdAt: 1 }],
  })
  useChat.setState({
    byId: {},
    conversationsByProject: {},
    conversations: [],
    projectId: null,
    activeId: null,
    ...chatOriginal,
  })
  useMission.setState({ byConv: {} })
  useInteractions.setState({ queue: [] })
  usePresets.setState({ list: [], todas: [], loaded: true, projectPath: null })
})

afterEach(() => {
  useChat.setState({ ...chatOriginal })
})

// ---------------------------------------------------------------- snapshot C2

describe("snapshot C2 — finalizando, escolhas e Especialistas", () => {
  it("turno FINALIZANDO entra em running[] com a marca honesta (antes ele sumia)", () => {
    useChat.setState({
      byId: {
        c1: makeConv({ running: true, runId: "run-1", startedAt: 10 }),
        c2: makeConv({ finalizing: true }),
      },
    })
    const snap = buildCompanionSnapshot()
    expect(snap.running).toHaveLength(2)
    const vivo = snap.running.find((r) => r.convId === "c1")
    expect(vivo?.finalizing).toBeUndefined()
    const fechando = snap.running.find((r) => r.convId === "c2")
    expect(fechando).toMatchObject({
      kind: "turno",
      detail: "finalizando…",
      finalizing: true,
    })
  })

  it("question com opções viaja com choices (shape do AskUserQuestion); sem opções, não", () => {
    useInteractions.setState({
      queue: [
        {
          // payload REAL do ask_user (interactive-input): header curto,
          // multiSelect e options com label+description.
          id: "q1",
          run_id: "run-1",
          kind: "question",
          data: {
            questions: [
              {
                header: "Cache",
                question: "Qual estratégia de cache prefere?",
                multiSelect: false,
                options: [
                  { label: "TTL curto", description: "30s, mais simples" },
                  { label: "Invalidação por evento", description: "preciso" },
                ],
              },
            ],
          },
        },
        {
          id: "q2",
          kind: "question",
          data: {
            questions: [
              { header: "Lib", question: "Qual lib usar?", multiSelect: false, options: [] },
            ],
          },
        },
      ],
    })
    const snap = buildCompanionSnapshot()
    const comOpcoes = snap.attention.find((a) => a.id === "q1")
    expect(comOpcoes?.choices).toEqual([
      {
        header: "Cache",
        question: "Qual estratégia de cache prefere?",
        multiSelect: false,
        options: [
          { label: "TTL curto", description: "30s, mais simples" },
          { label: "Invalidação por evento", description: "preciso" },
        ],
      },
    ])
    // sem opções: o fluxo de texto livre segue, sem chave nova
    const semOpcoes = snap.attention.find((a) => a.id === "q2")
    expect(semOpcoes && "choices" in semOpcoes).toBe(false)
  })

  it("Especialistas GLOBAIS viajam no snapshot; escopo-projeto fica fora", () => {
    usePresets.setState({
      list: [
        makeSpecialist({ id: "revisor", name: "Revisor", category: "Qualidade" }),
        makeSpecialist({
          id: "arquiteto",
          name: "Arquiteto",
          backend: "codex",
          scope: "projeto",
        }),
      ],
      loaded: true,
    })
    const snap = buildCompanionSnapshot()
    expect(snap.specialists).toEqual([
      { id: "revisor", name: "Revisor", backend: "claude-code", category: "Qualidade" },
    ])
  })
})

// ------------------------------------------------------------- launch_task C2

describe("launch_task — conversa nova pelo MESMO caminho do composer", () => {
  it("cria a conversa (título derivado do prompt), marca o Especialista e envia; o aceite volta ok pro celular", async () => {
    const registerConversation = vi.fn(
      async (_pid: string, _id: string, _title: string, _agent?: string) => {},
    )
    const ensureConversationLoaded = vi.fn(async () => {})
    const setConversationPreset = vi.fn(async () => {})
    useChat.setState({
      registerConversation,
      ensureConversationLoaded,
      setConversationPreset,
    })
    vi.mocked(getAgentDef).mockResolvedValue(
      makeSpecialist({ id: "revisor", name: "Revisor", backend: "codex" }),
    )
    vi.mocked(sendFromDesk).mockImplementation(async (args) => {
      args.onAccepted?.("started")
    })
    const prompt =
      "Cobrir o parser de stream com testes de fixture real, incluindo os eventos de tool"
    await handleCompanionAction({
      kind: "launch_task",
      projectId: "p1",
      agent: "claude-code",
      text: prompt,
      presetId: "revisor",
      actionId: AID,
    })
    // conversa registrada SEM roubar seleção, título = régua do deriveTitle
    expect(registerConversation).toHaveBeenCalledTimes(1)
    const [pid, convId, title, agent] = registerConversation.mock.calls[0]
    expect(pid).toBe("p1")
    expect(title).toBe(`${prompt.slice(0, 44)}…`)
    // agent EFETIVO = backend do Especialista
    expect(agent).toBe("codex")
    expect(setConversationPreset).toHaveBeenCalledWith(convId, {
      id: "revisor",
      name: "Revisor",
      backend: "codex",
    })
    // envio pelo caminho da casa, na MESMA conversa criada
    expect(sendFromDesk).toHaveBeenCalledWith(
      expect.objectContaining({
        convId,
        projectId: "p1",
        projectPath: "/proj/alpha",
        text: prompt,
      }),
    )
    // veredito honesto: ok com a conversa pro celular navegar direto
    expect(actionResults()).toEqual([
      expect.objectContaining({
        actionId: AID,
        kind: "launch_task",
        ok: true,
        convId,
        projectId: "p1",
        agent: "codex",
      }),
    ])
  })

  it("sem Especialista: lança direto no agent escolhido", async () => {
    const registerConversation = vi.fn(
      async (_pid: string, _id: string, _title: string, _agent?: string) => {},
    )
    useChat.setState({
      registerConversation,
      ensureConversationLoaded: vi.fn(async () => {}),
    })
    vi.mocked(sendFromDesk).mockImplementation(async (args) => {
      args.onAccepted?.("started")
    })
    await handleCompanionAction({
      kind: "launch_task",
      projectId: "p1",
      agent: "codex",
      text: "roda o lint",
      actionId: AID,
    })
    expect(getAgentDef).not.toHaveBeenCalled()
    expect(registerConversation.mock.calls[0]?.[3]).toBe("codex")
    expect(actionResults()[0]).toMatchObject({ ok: true, agent: "codex" })
  })

  it("projeto que sumiu do app: fail-closed com motivo legível, nada criado", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const registerConversation = vi.fn(async () => {})
    useChat.setState({ registerConversation })
    await handleCompanionAction({
      kind: "launch_task",
      projectId: "p-fantasma",
      agent: "codex",
      text: "oi",
      actionId: AID,
    })
    expect(registerConversation).not.toHaveBeenCalled()
    expect(sendFromDesk).not.toHaveBeenCalled()
    expect(actionResults()).toEqual([
      expect.objectContaining({
        actionId: AID,
        kind: "launch_task",
        ok: false,
        message: "O projeto não existe mais no app.",
      }),
    ])
    warn.mockRestore()
  })

  it("Especialista inexistente/ilegível no projeto: recusa ANTES de criar conversa", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const registerConversation = vi.fn(async () => {})
    useChat.setState({ registerConversation })
    vi.mocked(getAgentDef).mockResolvedValue(null)
    await handleCompanionAction({
      kind: "launch_task",
      projectId: "p1",
      agent: "claude-code",
      text: "oi",
      presetId: "sumido",
      actionId: AID,
    })
    expect(registerConversation).not.toHaveBeenCalled()
    expect(actionResults()[0]).toMatchObject({
      ok: false,
      message: "O Especialista escolhido não está disponível neste projeto.",
    })
    // arquivo ilegível (throw) idem, com mensagem própria
    vi.mocked(getAgentDef).mockRejectedValue(new Error("EACCES"))
    await handleCompanionAction({
      kind: "launch_task",
      projectId: "p1",
      agent: "claude-code",
      text: "oi",
      presetId: "quebrado",
      actionId: "bbbbccddeeff00112233445566778899",
    })
    expect(actionResults()[1]).toMatchObject({
      ok: false,
      message: "Não consegui carregar o Especialista escolhido.",
    })
    expect(sendFromDesk).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("F-A: CLI do agent EFETIVO deslogada recusa com o motivo da casa, nada criado", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
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
    const registerConversation = vi.fn(async () => {})
    useChat.setState({ registerConversation })
    // Especialista aponta pro codex (deslogado) mesmo com a ação vindo como
    // claude-code: a guarda vale pro agent EFETIVO.
    vi.mocked(getAgentDef).mockResolvedValue(
      makeSpecialist({ id: "arquiteto", name: "Arquiteto", backend: "codex" }),
    )
    try {
      await handleCompanionAction({
        kind: "launch_task",
        projectId: "p1",
        agent: "claude-code",
        text: "oi",
        presetId: "arquiteto",
        actionId: AID,
      })
      expect(registerConversation).not.toHaveBeenCalled()
      expect(sendFromDesk).not.toHaveBeenCalled()
      const r = actionResults()[0]
      expect(r).toMatchObject({ ok: false })
      expect(String(r.message)).toContain("sem login")
    } finally {
      useApp.setState({ settings })
      warn.mockRestore()
    }
  })

  it("sendFromDesk REJEITOU (ex.: DB falhou no load interno): o veredito de erro ainda sai — nunca só timeout", async () => {
    // revisão C2 §1: sem o catch, a exceção escapava, o fail() nunca rodava e
    // nenhum action-result saía — o celular ficava 25s no escuro.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    useChat.setState({
      registerConversation: vi.fn(async () => {}),
      ensureConversationLoaded: vi.fn(async () => {}),
    })
    vi.mocked(sendFromDesk).mockRejectedValue(
      new Error("banco indisponível durante o load"),
    )
    await expect(
      handleCompanionAction({
        kind: "launch_task",
        projectId: "p1",
        agent: "codex",
        text: "oi",
        actionId: AID,
      }),
    ).resolves.toBeUndefined() // a exceção NÃO escapa do executor
    expect(actionResults()).toEqual([
      expect.objectContaining({
        actionId: AID,
        kind: "launch_task",
        ok: false,
        message:
          "O app não conseguiu iniciar o turno. Veja o desktop para detalhes.",
      }),
    ])
    warn.mockRestore()
  })

  it("guarda interna do sendFromDesk abortou (onAccepted nunca veio): fracasso honesto, não silêncio", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    useChat.setState({
      registerConversation: vi.fn(async () => {}),
      ensureConversationLoaded: vi.fn(async () => {}),
    })
    vi.mocked(sendFromDesk).mockResolvedValue(undefined) // aborta sem aceitar
    await handleCompanionAction({
      kind: "launch_task",
      projectId: "p1",
      agent: "codex",
      text: "oi",
      actionId: AID,
    })
    expect(actionResults()[0]).toMatchObject({
      actionId: AID,
      ok: false,
      message: "O app não conseguiu iniciar o turno. Veja o desktop para detalhes.",
    })
    warn.mockRestore()
  })

  it("malformado (sem texto / agent fora da whitelist) é recusado com aviso", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await handleCompanionAction({
      kind: "launch_task",
      projectId: "p1",
      agent: "rm-rf",
      text: "oi",
      actionId: AID,
    })
    await handleCompanionAction({
      kind: "launch_task",
      projectId: "p1",
      agent: "codex",
      text: "   ",
      actionId: "bbbbccddeeff00112233445566778899",
    })
    expect(sendFromDesk).not.toHaveBeenCalled()
    expect(actionResults()).toHaveLength(2)
    expect(actionResults().every((r) => r.ok === false)).toBe(true)
    warn.mockRestore()
  })
})

// ----------------------------------------------------- parar com veredito C2

describe("stop_turn / stop_mission — veredito honesto de volta pro celular", () => {
  it("turno rodando: cancela e responde interrompido", async () => {
    useChat.setState({
      byId: { c1: makeConv({ running: true, runId: "run-1" }) },
    })
    await handleCompanionAction({ kind: "stop_turn", convId: "c1", actionId: AID })
    expect(cancelDeskTurn).toHaveBeenCalledWith("c1")
    expect(actionResults()).toEqual([
      expect.objectContaining({
        actionId: AID,
        kind: "stop_turn",
        ok: true,
        message: "Turno interrompido.",
        convId: "c1",
      }),
    ])
  })

  it("turno FINALIZANDO: não finge que parou — copy honesta da casa", async () => {
    useChat.setState({ byId: { c1: makeConv({ finalizing: true }) } })
    await handleCompanionAction({ kind: "stop_turn", convId: "c1", actionId: AID })
    const r = actionResults()[0]
    expect(r.ok).toBe(false)
    expect(String(r.message)).toContain("finalizando")
  })

  it("turno que já acabou: o resultado diz isso, nada de sucesso fingido", async () => {
    useChat.setState({ byId: { c1: makeConv() } })
    await handleCompanionAction({ kind: "stop_turn", convId: "c1", actionId: AID })
    expect(actionResults()[0]).toMatchObject({
      ok: false,
      message: "O turno já não estava em execução.",
    })
  })

  it("stop_mission: rodando interrompe; morta responde que já tinha acabado", async () => {
    const abort = vi.fn()
    useMission.setState({
      byConv: { c2: makeMission({ status: "running" }) },
      abort,
    })
    await handleCompanionAction({ kind: "stop_mission", convId: "c2", actionId: AID })
    expect(abort).toHaveBeenCalledWith("c2")
    expect(actionResults()[0]).toMatchObject({ ok: true, message: "Missão interrompida." })

    useMission.setState({ byConv: { c2: makeMission({ status: "done" }) }, abort })
    await handleCompanionAction({
      kind: "stop_mission",
      convId: "c2",
      actionId: "bbbbccddeeff00112233445566778899",
    })
    expect(actionResults()[1]).toMatchObject({
      ok: false,
      message: "A missão já não estava em execução.",
    })
  })

  it("sem actionId (página antiga): comportamento de sempre, nenhum action-result", async () => {
    useChat.setState({ byId: { c1: makeConv({ running: true, runId: "r" }) } })
    await handleCompanionAction({ kind: "stop_turn", convId: "c1" })
    expect(cancelDeskTurn).toHaveBeenCalledWith("c1")
    expect(actionResults()).toHaveLength(0)
  })
})
