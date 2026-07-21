// Vigia de turno mudo (P2): dispara após o limiar, UMA vez por episódio,
// fecha com atividade/fim do turno, respeita 0=off e o cancelamento mata o
// run via cancelAgent. checkStalledTurns é determinística com `now` injetado.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: vi.fn() }))
// notify importa o plugin nativo do Tauri — mock inteiro (só o spy interessa).
vi.mock("@/lib/notify", () => ({
  notifyTurnStalled: vi.fn(),
  nativeNotify: vi.fn(async () => {}),
}))
// cancelAgent invoca o Tauri — mocado p/ não vazar (padrão mission.*.test).
vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, cancelAgent: vi.fn(async () => {}) }
})

import { toast } from "sonner"
import { cancelAgent } from "@/lib/agent"
import { notifyTurnStalled } from "@/lib/notify"
import { useApp } from "@/store/app"
import { useChat, type ChatItem, type ConvState } from "@/store/chat"
import {
  _resetWatchdogState,
  cancelStalledTurn,
  checkStalledTurns,
} from "./watchdog"

const T0 = 1_700_000_000_000
const MIN = 60_000

let n = 0
function textItem(text = "trabalhando…"): ChatItem {
  return { kind: "text", id: `t${n++}`, text }
}

function conv(over: Partial<ConvState> = {}): ConvState {
  return {
    projectId: "p1",
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [textItem()],
    sessionId: null,
    model: null,
    streamingTextId: null,
    running: true,
    finalizing: false,
    runId: "r1",
    startedAt: T0,
    suggestions: [],
    suggesting: false,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetWatchdogState()
  useChat.setState({ byId: {} })
  useApp.getState().setSettings({ stalledAfterMin: 10 })
})

describe("checkStalledTurns", () => {
  it("dispara UMA vez após o limiar de silêncio (nativa + toast + flag)", () => {
    useChat.setState({ byId: { c1: conv() } })
    checkStalledTurns(T0) // baseline
    checkStalledTurns(T0 + 9 * MIN) // ainda dentro do limiar
    expect(notifyTurnStalled).not.toHaveBeenCalled()

    checkStalledTurns(T0 + 10 * MIN)
    expect(notifyTurnStalled).toHaveBeenCalledTimes(1)
    expect(notifyTurnStalled).toHaveBeenCalledWith("c1", "claude-code", 10)
    expect(toast).toHaveBeenCalledTimes(1)
    // flag transient aponta pra ÚLTIMA atividade (início do silêncio)
    expect(useChat.getState().byId.c1.stalledSince).toBe(T0)

    // silêncio continuado NÃO re-notifica (1 por episódio)
    checkStalledTurns(T0 + 15 * MIN)
    checkStalledTurns(T0 + 60 * MIN)
    expect(notifyTurnStalled).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it("atividade fecha o episódio; mudo de novo por OUTRO período re-notifica", () => {
    useChat.setState({ byId: { c1: conv() } })
    checkStalledTurns(T0)
    checkStalledTurns(T0 + 10 * MIN)
    expect(notifyTurnStalled).toHaveBeenCalledTimes(1)

    // o agent voltou a produzir (itens mudaram)
    const c = useChat.getState().byId.c1
    useChat.setState({
      byId: { c1: { ...c, items: [...c.items, textItem("voltei")] } },
    })
    checkStalledTurns(T0 + 12 * MIN)
    expect(useChat.getState().byId.c1.stalledSince).toBeUndefined()

    // silêncio parcial (9min) não dispara…
    checkStalledTurns(T0 + 21 * MIN)
    expect(notifyTurnStalled).toHaveBeenCalledTimes(1)
    // …outro período COMPLETO de silêncio dispara de novo
    checkStalledTurns(T0 + 22 * MIN)
    expect(notifyTurnStalled).toHaveBeenCalledTimes(2)
  })

  it("fim do turno limpa o episódio sem notificar de novo", () => {
    useChat.setState({ byId: { c1: conv() } })
    checkStalledTurns(T0)
    checkStalledTurns(T0 + 10 * MIN)
    expect(useChat.getState().byId.c1.stalledSince).toBe(T0)

    const c = useChat.getState().byId.c1
    useChat.setState({ byId: { c1: { ...c, running: false, runId: null } } })
    checkStalledTurns(T0 + 11 * MIN)
    expect(useChat.getState().byId.c1.stalledSince).toBeUndefined()
    expect(notifyTurnStalled).toHaveBeenCalledTimes(1)
  })

  it("setting 0 desliga o vigia (nem aviso, nem flag)", () => {
    useApp.getState().setSettings({ stalledAfterMin: 0 })
    useChat.setState({ byId: { c1: conv() } })
    checkStalledTurns(T0)
    checkStalledTurns(T0 + 120 * MIN)
    expect(notifyTurnStalled).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
    expect(useChat.getState().byId.c1.stalledSince).toBeUndefined()
  })

  it("conversa que não está rodando nunca é vigiada", () => {
    useChat.setState({ byId: { c1: conv({ running: false, runId: null }) } })
    checkStalledTurns(T0)
    checkStalledTurns(T0 + 30 * MIN)
    expect(notifyTurnStalled).not.toHaveBeenCalled()
  })
})

describe("cancelStalledTurn", () => {
  it("cancela o run corrente (cancelAgent com o runId)", async () => {
    useChat.setState({ byId: { c1: conv({ runId: "r9" }) } })
    await cancelStalledTurn("c1")
    expect(cancelAgent).toHaveBeenCalledWith("r9")
  })

  it("sem runId não invoca cancelAgent (turno já morreu sozinho)", async () => {
    useChat.setState({ byId: { c1: conv({ runId: null, running: false }) } })
    await cancelStalledTurn("c1")
    expect(cancelAgent).not.toHaveBeenCalled()
  })
})
