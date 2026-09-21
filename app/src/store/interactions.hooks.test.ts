// H2 (hooks-plan) — aviso de PERMISSÃO vinda de HOOK (sessão externa no
// terminal). O pedido não tem conversa dona POR DESENHO (não somos donos da
// sessão): antes o announceArrival descartava todo órfão em silêncio — mas o
// hook carrega a origem (engine + cwd) e a janela de resposta é de 30s, então
// tem que avisar. Arquivo separado do interactions.notify.test.ts porque o
// mock de notify aqui inclui o notifyHookPermission.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { InteractionRequest } from "@/lib/interaction"
import {
  notifyApproval,
  notifyHookPermission,
  notifyQuestion,
} from "@/lib/notify"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useMission } from "@/store/mission"
import { announceArrival, useInteractions } from "./interactions"

vi.mock("@/lib/interaction", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/interaction")>()
  return { ...mod, answerInteraction: vi.fn(async () => {}) }
})
vi.mock("@/lib/notify", () => ({
  notifyApproval: vi.fn(),
  notifyQuestion: vi.fn(),
  notifyHookPermission: vi.fn(),
}))

/** Pedido de permissão como o hook_gateway emite (run_id vazio + data.hook). */
function pedidoDeHook(
  id: string,
  over: Partial<{ engine: string; cwd: string }> = {},
): InteractionRequest {
  return {
    id,
    run_id: "",
    kind: "approval",
    data: {
      tool_name: "Bash",
      command: "rm -rf /tmp/build",
      input: { command: "rm -rf /tmp/build" },
      hook: {
        engine: over.engine ?? "claude-code",
        sessionId: "26f8cfe6-f107-46c5-834c-ab8b2832cf11",
        cwd: over.cwd ?? "/Users/v/projetos/mycockpit/app",
      },
    },
  }
}

beforeEach(() => {
  useInteractions.setState({ queue: [] })
  useChat.setState({ byId: {}, conversationsByProject: {} })
  useMission.setState({ byConv: {} })
  useApp.setState({
    projects: [
      {
        id: "px",
        name: "Frota",
        path: "/Users/v/projetos/mycockpit",
        createdAt: 0,
      },
    ],
  })
  vi.mocked(notifyApproval).mockClear()
  vi.mocked(notifyQuestion).mockClear()
  vi.mocked(notifyHookPermission).mockClear()
})

describe("announceArrival de permissão de hook (sessão externa)", () => {
  it("avisa com motor, projeto resolvido pelo cwd e headline do comando", () => {
    announceArrival(pedidoDeHook("hookperm-1"), [])
    expect(notifyHookPermission).toHaveBeenCalledTimes(1)
    expect(notifyHookPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "Claude",
        place: "Frota",
        projectId: "px",
        toolName: "Bash",
      }),
    )
    // os avisos de conversa dona NÃO disparam (não há conversa).
    expect(notifyApproval).not.toHaveBeenCalled()
    expect(notifyQuestion).not.toHaveBeenCalled()
  })

  it("cwd fora de projeto conhecido degrada pro basename, sem projectId", () => {
    announceArrival(pedidoDeHook("hookperm-2", { cwd: "/tmp/spike-x" }), [])
    expect(notifyHookPermission).toHaveBeenCalledWith(
      expect.objectContaining({ place: "spike-x", projectId: null }),
    )
  })

  it("motor desconhecido no registry degrada pro próprio id (fail-open)", () => {
    announceArrival(
      pedidoDeHook("hookperm-3", { engine: "motor-novo" }),
      [],
    )
    expect(notifyHookPermission).toHaveBeenCalledWith(
      expect.objectContaining({ engine: "motor-novo" }),
    )
  })

  it("órfão SEM origem de hook segue mudo (não inventa aviso)", () => {
    const semHook: InteractionRequest = {
      id: "a1",
      run_id: "",
      kind: "approval",
      data: { tool_name: "Bash", command: "ls", input: {} },
    }
    announceArrival(semHook, [])
    expect(notifyHookPermission).not.toHaveBeenCalled()
    expect(notifyApproval).not.toHaveBeenCalled()
  })

  it("pergunta órfã não vira aviso de permissão (kind importa)", () => {
    const pergunta: InteractionRequest = {
      id: "q1",
      run_id: "",
      kind: "question",
      data: {
        questions: [
          { header: "X", question: "?", multiSelect: false, options: [] },
        ],
      },
    }
    announceArrival(pergunta, [])
    expect(notifyHookPermission).not.toHaveBeenCalled()
  })

  it("o pedido entra na fila normal (respondível pelo answer de sempre)", () => {
    useInteractions.getState().push(pedidoDeHook("hookperm-4"))
    expect(useInteractions.getState().queue.map((r) => r.id)).toEqual([
      "hookperm-4",
    ])
  })
})
