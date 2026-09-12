import { beforeEach, describe, expect, it } from "vitest"
import { selectRunLiveness, useChat, type ConvState } from "@/store/chat"

const T0 = 1_788_962_247_781

function conv(patch: Partial<ConvState> = {}): ConvState {
  return {
    projectId: "p1",
    agent: "agy",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [{ kind: "user", id: "u1", text: "roda os testes", ts: T0 - 10_000 }],
    sessionId: null,
    model: "gemini-2.5-pro",
    streamingTextId: null,
    running: true,
    finalizing: false,
    runId: "run-1",
    startedAt: T0 - 10_000,
    suggestions: [],
    suggesting: false,
    ...patch,
  }
}

describe("telemetria desacoplada de liveness (ADR-183)", () => {
  beforeEach(() => {
    useChat.setState({
      activeId: "c1",
      byId: {
        c1: conv(),
      },
      runLivenessByConv: {},
    })
  })

  it("run_status atualiza runLivenessByConv preservando a identidade de byId[convId]", () => {
    const beforeConv = useChat.getState().byId.c1
    expect(beforeConv).toBeDefined()

    useChat.getState().handleEvent("c1", {
      type: "run_status",
      main_alive: true,
      descendants: 4,
      rss_mb: 2077,
      last_byte_at: T0 - 1_000,
      observed_at: T0,
    })

    const afterConv = useChat.getState().byId.c1
    // A identidade da conversa NAO muda: ChatPanel e MessageList nao sofrem re-render
    expect(afterConv).toBe(beforeConv)

    // O liveness fica registrado em runLivenessByConv
    const liveness = useChat.getState().runLivenessByConv.c1
    expect(liveness).toBeDefined()
    expect(liveness?.mainAlive).toBe(true)
    expect(liveness?.descendants).toBe(4)
    expect(liveness?.rssMb).toBe(2077)
    expect(liveness?.observedAt).toBe(T0)
  })

  it("selectRunLiveness resolve o liveness da conversa ativa ou especificada", () => {
    useChat.setState((s) => ({
      ...s,
      activeId: "c1",
      runLivenessByConv: {
        c1: {
          mainAlive: true,
          descendants: 2,
          rssMb: 512,
          lastByteAt: null,
          lastEventAt: null,
          observedAt: T0,
        },
      },
    }))

    const state = useChat.getState()
    // Quando convId é omitido, resolve a conversa ativa
    const livenessAtiva = selectRunLiveness(state)
    expect(livenessAtiva).toBeDefined()
    expect(livenessAtiva?.descendants).toBe(2)
    expect(livenessAtiva?.rssMb).toBe(512)

    // Quando convId é explícito
    const livenessExplicita = selectRunLiveness(state, "c1")
    expect(livenessExplicita?.rssMb).toBe(512)

    // Quando convId é inexistente
    const livenessInexistente = selectRunLiveness(state, "c2")
    expect(livenessInexistente).toBeUndefined()
  })

  it("selectRunLiveness faz fallback gracioso para byId[convId].runLiveness se não estiver no mapa", () => {
    useChat.setState({
      activeId: "c1",
      byId: {
        c1: conv({
          runLiveness: {
            mainAlive: true,
            descendants: 1,
            rssMb: 256,
            lastByteAt: null,
            lastEventAt: null,
            observedAt: T0,
          },
        }),
      },
      runLivenessByConv: {},
    })

    const state = useChat.getState()
    const liveness = selectRunLiveness(state, "c1")
    expect(liveness?.rssMb).toBe(256)
  })
})
