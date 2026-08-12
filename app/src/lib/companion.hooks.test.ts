// H2 (hooks-plan) — a pendência de permissão de HOOK (sessão externa no
// terminal) chega ao Companion com origem honesta: motor + projeto/pasta do
// cwd, SEM conversa inventada (convId null — não somos donos da sessão). A
// resposta volta pelo MESMO answer_interaction de sempre (id da fila única).
// Arquivo separado (mocks mínimos, sem contaminar C1/C2).

import { beforeEach, describe, expect, it, vi } from "vitest"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"
import { buildCompanionSnapshot } from "./companion"

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
vi.mock("@/lib/notify", () => ({
  nativeNotify: vi.fn(async () => {}),
  notifyApproval: vi.fn(),
  notifyQuestion: vi.fn(),
  notifyHookPermission: vi.fn(),
}))
vi.mock("@/lib/fleet/send", () => ({
  DESK_TITLE_PREFIX: "Mesa · ",
  ensureDeskConversation: vi.fn(async () => "conv-mesa"),
  sendFromDesk: vi.fn(async () => {}),
  cancelDeskTurn: vi.fn(async () => {}),
}))
vi.mock("@/lib/learning", () => ({ feedbackLesson: vi.fn(async () => {}) }))
vi.mock("@/lib/agentDefs", () => ({ getAgentDef: vi.fn(async () => null) }))

beforeEach(() => {
  useChat.setState({ byId: {}, conversationsByProject: {} })
  useMission.setState({ byConv: {} })
  useInteractions.setState({ queue: [] })
  useApp.setState({
    projects: [
      {
        id: "px",
        name: "MyCockpit",
        path: "/Users/v/projetos/mycockpit",
        createdAt: 0,
      },
    ],
  })
})

describe("snapshot do Companion com permissão de hook", () => {
  it("pendência de sessão externa vira attention com origem honesta", () => {
    useInteractions.setState({
      queue: [
        {
          id: "hookperm-1",
          run_id: "",
          kind: "approval",
          data: {
            tool_name: "Bash",
            command: "rm -rf /tmp/build",
            input: { command: "rm -rf /tmp/build" },
            hook: {
              engine: "codex",
              sessionId: "sess-1",
              cwd: "/Users/v/projetos/mycockpit/app",
            },
          },
        },
      ],
    })
    const snap = buildCompanionSnapshot()
    const at = snap.attention.find((a) => a.id === "hookperm-1")
    expect(at).toBeDefined()
    expect(at?.kind).toBe("approval")
    // sem conversa dona POR DESENHO: nunca inventa vínculo.
    expect(at?.convId).toBeNull()
    // mas com origem: motor + projeto resolvido pelo cwd.
    expect(at?.agent).toBe("codex")
    expect(at?.projectId).toBe("px")
    expect(at?.projectName).toBe("MyCockpit (terminal)")
    expect(at?.toolName).toBe("Bash")
    expect(at?.command).toBe("rm -rf /tmp/build")
  })

  it("cwd desconhecido degrada pro basename, sem projectId", () => {
    useInteractions.setState({
      queue: [
        {
          id: "hookperm-2",
          run_id: "",
          kind: "approval",
          data: {
            tool_name: "run_command",
            command: "npm test",
            input: {},
            hook: { engine: "agy", sessionId: "s", cwd: "/tmp/spike-x" },
          },
        },
      ],
    })
    const at = buildCompanionSnapshot().attention[0]
    expect(at.projectId).toBeNull()
    expect(at.projectName).toBe("spike-x (terminal)")
    expect(at.agent).toBe("agy")
  })

  it("aprovação órfã SEM hook segue como antes (sem origem inventada)", () => {
    useInteractions.setState({
      queue: [
        {
          id: "a1",
          run_id: "",
          kind: "approval",
          data: { tool_name: "Bash", command: "ls", input: {} },
        },
      ],
    })
    const at = buildCompanionSnapshot().attention[0]
    expect(at.projectName).toBeNull()
    expect(at.agent).toBe("")
  })
})
