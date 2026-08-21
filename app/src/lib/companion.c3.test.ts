// C3 — Conversa (docs/companion-plan.md): send_message com actionId ganha o
// MESMO veredito honesto (action-result) do launch_task — o 202 é só "aceitei";
// aceite volta com o convId REAL (a página sem conversa resolvida adota o fio
// na hora) e recusa volta com o motivo legível. Sem actionId, o comportamento
// pré-existente segue intacto (compat com página antiga). Arquivo separado dos
// C1/C2 de propósito: os mocks daqui não podem contaminar as suítes anteriores.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { sendFromDesk } from "@/lib/fleet/send"
import { useApp } from "@/store/app"
import { useChat, type ConvState } from "@/store/chat"
import { useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"
import { usePresets } from "@/store/presets"
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

/** Chamadas de companion_action_result registradas no invoke mocado. */
function actionResults(): Record<string, unknown>[] {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "companion_action_result")
    .map(([, args]) => (args as { result: Record<string, unknown> }).result)
}

const chatOriginal = {
  ensureConversationLoaded: useChat.getState().ensureConversationLoaded,
  persist: useChat.getState().persist,
}

const AID = "ccddeeff00112233445566778899aabb"

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
    ensureConversationLoaded: vi.fn(async () => {}),
    persist: vi.fn(async () => {}),
  })
  useMission.setState({ byConv: {} })
  useInteractions.setState({ queue: [] })
  usePresets.setState({ list: [], todas: [], loaded: true, projectPath: null })
})

afterEach(() => {
  useChat.setState({ ...chatOriginal })
})

describe("send_message com actionId — veredito honesto pro celular (C3)", () => {
  it("aceite responde ok com o convId REAL da mesa (a página adota o fio na hora)", async () => {
    vi.mocked(sendFromDesk).mockImplementation(async (args) => {
      args.onAccepted?.("started")
    })
    await handleCompanionAction({
      kind: "send_message",
      projectId: "p1",
      agent: "codex",
      text: "roda os testes",
      actionId: AID,
    })
    expect(actionResults()).toEqual([
      expect.objectContaining({
        actionId: AID,
        kind: "send_message",
        ok: true,
        message: "Mensagem enviada.",
        convId: "conv-mesa",
        projectId: "p1",
        agent: "codex",
      }),
    ])
  })

  it("convId explícito das metas do projeto: o veredito volta com ESSA conversa", async () => {
    useChat.setState({
      conversationsByProject: {
        p1: [
          {
            id: "c9",
            title: "antiga",
            updatedAt: 1,
            color: null,
            worktreePath: null,
            agent: "codex",
          },
        ],
      },
      byId: { c9: makeConv({ agent: "codex" }) },
    })
    vi.mocked(sendFromDesk).mockImplementation(async (args) => {
      args.onAccepted?.("started")
    })
    await handleCompanionAction({
      kind: "send_message",
      projectId: "p1",
      agent: "codex",
      text: "continua",
      convId: "c9",
      actionId: AID,
    })
    expect(sendFromDesk).toHaveBeenCalledWith(
      expect.objectContaining({ convId: "c9" }),
    )
    expect(actionResults()[0]).toMatchObject({ ok: true, convId: "c9" })
  })

  it("CLI deslogada (F-A): além do notice no fio, o motivo volta como veredito direto", async () => {
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
    useChat.setState({ byId: { "conv-mesa": makeConv({ agent: "codex" }) } })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await handleCompanionAction({
        kind: "send_message",
        projectId: "p1",
        agent: "codex",
        text: "oi",
        actionId: AID,
      })
      expect(sendFromDesk).not.toHaveBeenCalled()
      // envelope pré-existente segue: notice persistido no fio
      const items = useChat.getState().byId["conv-mesa"].items
      expect(items.some((it) => it.kind === "notice")).toBe(true)
      // e o veredito direto chega com o MESMO motivo (sem depender do refetch)
      const r = actionResults()[0]
      expect(r).toMatchObject({ actionId: AID, kind: "send_message", ok: false })
      expect(String(r.message)).toContain("sem login")
    } finally {
      useApp.setState({ settings })
      warn.mockRestore()
    }
  })

  it("projeto que sumiu / pedido malformado: recusa com motivo legível, nada despachado", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await handleCompanionAction({
      kind: "send_message",
      projectId: "p-fantasma",
      agent: "codex",
      text: "oi",
      actionId: AID,
    })
    await handleCompanionAction({
      kind: "send_message",
      projectId: "p1",
      agent: "rm-rf",
      text: "oi",
      actionId: "ddddeeff00112233445566778899aabb",
    })
    expect(sendFromDesk).not.toHaveBeenCalled()
    const rs = actionResults()
    expect(rs).toHaveLength(2)
    expect(rs[0]).toMatchObject({
      ok: false,
      message: "O projeto não existe mais no app.",
    })
    expect(rs[1]).toMatchObject({ ok: false })
    warn.mockRestore()
  })

  it("sendFromDesk REJEITOU: o veredito de erro sai e a exceção NÃO escapa (celular nunca fica no escuro)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(sendFromDesk).mockRejectedValue(new Error("banco indisponível"))
    await expect(
      handleCompanionAction({
        kind: "send_message",
        projectId: "p1",
        agent: "codex",
        text: "oi",
        actionId: AID,
      }),
    ).resolves.toBeUndefined()
    expect(actionResults()).toEqual([
      expect.objectContaining({
        actionId: AID,
        kind: "send_message",
        ok: false,
        message:
          "O app não conseguiu iniciar o turno. Veja o desktop para detalhes.",
      }),
    ])
    warn.mockRestore()
  })

  it("guarda interna abortou (onAccepted nunca veio): fracasso honesto, não silêncio", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(sendFromDesk).mockResolvedValue(undefined)
    await handleCompanionAction({
      kind: "send_message",
      projectId: "p1",
      agent: "codex",
      text: "oi",
      actionId: AID,
    })
    expect(actionResults()[0]).toMatchObject({
      actionId: AID,
      kind: "send_message",
      ok: false,
    })
    warn.mockRestore()
  })

  it("sem actionId (página antiga): shape da chamada intacto, rejeição ESCAPA pro listener e nenhum action-result", async () => {
    vi.mocked(sendFromDesk).mockImplementation(async (args) => {
      // compat: sem actionId o onAccepted nem viaja (shape pré-C3)
      expect("onAccepted" in args).toBe(false)
      args.onAccepted?.("started")
    })
    await handleCompanionAction({
      kind: "send_message",
      projectId: "p1",
      agent: "codex",
      text: "oi",
    })
    expect(actionResults()).toHaveLength(0)
    // rejeição sem actionId sobe como sempre (o catch do listener notifica)
    vi.mocked(sendFromDesk).mockRejectedValue(new Error("explodiu"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(
      handleCompanionAction({
        kind: "send_message",
        projectId: "p1",
        agent: "codex",
        text: "oi",
      }),
    ).rejects.toThrow("explodiu")
    expect(actionResults()).toHaveLength(0)
    warn.mockRestore()
  })
})
