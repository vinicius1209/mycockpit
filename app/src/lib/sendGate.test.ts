// O GATE DO TURNO EM VOO, com o store REAL.
//
// Ele é compartilhado pelas DUAS superfícies de envio (o `handleSend` do
// `ChatPanel` e o `sendFromDesk` da mesa), e nas duas ele aparecia duplicado:
// a guarda de entrada e a re-checagem de corrida pós-preflight ("D2") faziam
// `enqueue` cru, cada uma por conta própria. Quatro cópias da mesma decisão,
// nenhuma com teste. O incidente 2026-08-16 passou por uma delas.

import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ toast: vi.fn() }))

vi.mock("@/lib/avisos", async () => (await import("@/test/avisosFalsos")).moduloDeAvisosFalsos({ nota: h.toast, feito: vi.fn(), evento: vi.fn(), erro: vi.fn(), fechar: vi.fn() }))

import { retidoPorTurnoEmVoo } from "./sendGate"
import { AUTO_RESUME, HUMANO, PASTA_LIBERADA } from "./sendOrigin"
import { useChat, type ConvState } from "@/store/chat"

const CONV = "c-1"

function conversa(over: Partial<ConvState> = {}): ConvState {
  return {
    projectId: "p-1",
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
    ...over,
  }
}

function fila() {
  return useChat.getState().byId[CONV]?.queued ?? []
}

beforeEach(() => {
  h.toast.mockClear()
  useChat.setState({ byId: { [CONV]: conversa() }, activeId: CONV })
})

describe("conversa parada: o gate não retém nada", () => {
  it("humano passa direto (vira turno)", () => {
    expect(retidoPorTurnoEmVoo(CONV, "roda os testes", [], HUMANO)).toBe(false)
    expect(fila()).toEqual([])
  })

  it("sistema também passa direto: entre turnos a retomada É o conserto", () => {
    // O `--add-dir` é fixo no spawn, então reenviar é o projeto correto. O erro
    // nunca foi reenviar; foi reenviar com turno vivo, pela fila do humano.
    expect(retidoPorTurnoEmVoo(CONV, "reenvia", [], PASTA_LIBERADA)).toBe(false)
  })

  it("conversa que nem está carregada não é retida (quem decide é o chamador)", () => {
    useChat.setState({ byId: {} })
    expect(retidoPorTurnoEmVoo(CONV, "x", [], HUMANO)).toBe(false)
  })
})

describe("turno em voo: mensagem SUA espera na fila", () => {
  beforeEach(() => {
    useChat.setState({ byId: { [CONV]: conversa({ running: true }) } })
  })

  it("retém e empilha o texto com os anexos", () => {
    const anexo = {
      path: "attachments/c-1/8f3a2c1d0e.png",
      name: "Captura de Tela 2026-08-15 as 18.42.07.png",
      mime: "image/png",
      kind: "image" as const,
      bytes: 184_233,
    }
    expect(retidoPorTurnoEmVoo(CONV, "compara com o print", [anexo], HUMANO)).toBe(
      true,
    )
    expect(fila()).toEqual([{ text: "compara com o print", attachments: [anexo] }])
    expect(h.toast).not.toHaveBeenCalled()
  })

  it("finalizing conta como turno em voo", () => {
    useChat.setState({ byId: { [CONV]: conversa({ finalizing: true }) } })
    expect(retidoPorTurnoEmVoo(CONV, "depois isso", [], HUMANO)).toBe(true)
    expect(fila()).toHaveLength(1)
  })
})

describe("turno em voo: retomada do APP não encosta na fila", () => {
  beforeEach(() => {
    useChat.setState({ byId: { [CONV]: conversa({ running: true }) } })
  })

  it("pasta liberada: retém, não enfileira, e avisa o prazo", () => {
    expect(retidoPorTurnoEmVoo(CONV, "o pedido de novo", [], PASTA_LIBERADA)).toBe(
      true,
    )
    expect(fila()).toEqual([])
    expect(h.toast).toHaveBeenCalledWith(
      "Pasta liberada. Vale a partir do próximo envio.",
    )
  })

  it("auto-resume: mesma regra, aviso próprio", () => {
    expect(retidoPorTurnoEmVoo(CONV, "continue de onde parou", [], AUTO_RESUME)).toBe(
      true,
    )
    expect(fila()).toEqual([])
    expect(h.toast).toHaveBeenCalledWith(
      "Retomada automática dispensada: já tem um turno rodando aqui.",
    )
  })
})
