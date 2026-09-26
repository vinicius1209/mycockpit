// O pedido de RECURSO na fila (ADR-261): local como o gate de plano. Quem
// executa é o app (`responderRecurso`), nunca o `answer_interaction`; o dono é
// a conversa do payload; dispensar é recusar.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { answerInteraction } from "@/lib/interaction"
import { pedidoDeRecurso } from "@/lib/pedidosDeRecurso"
import { ownerByRunId, useInteractions } from "./interactions"

vi.mock("@/lib/interaction", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/interaction")>()
  return { ...mod, answerInteraction: vi.fn(async () => {}) }
})
const { responderRecurso } = vi.hoisted(() => ({ responderRecurso: vi.fn(async () => {}) }))
vi.mock("@/lib/pedidosDeRecurso", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/pedidosDeRecurso")>()
  return { ...mod, responderRecurso }
})

const pedido = pedidoDeRecurso("navegador", { runId: "r-7", convId: "c-7", projectPath: "/repo/maclan" })

beforeEach(() => {
  useInteractions.setState({ queue: [] })
  vi.mocked(answerInteraction).mockClear()
  responderRecurso.mockClear()
})

describe("pedido de recurso na fila", () => {
  it("responder executa no app e sai da fila na hora, sem passar pelo backend", () => {
    useInteractions.getState().push(pedido)
    useInteractions.getState().answer(pedido.id, { allow: true })
    expect(useInteractions.getState().queue).toHaveLength(0)
    expect(responderRecurso).toHaveBeenCalledWith(pedido, true, expect.any(Function))
    expect(answerInteraction).not.toHaveBeenCalled()
  })

  it("dispensar é recusar", () => {
    useInteractions.getState().push(pedido)
    useInteractions.getState().dismiss(pedido)
    expect(responderRecurso).toHaveBeenCalledWith(pedido, false, expect.any(Function))
  })

  it("se o gesto falhar, o pedido volta para a fila (o agente segue esperando)", () => {
    useInteractions.getState().push(pedido)
    useInteractions.getState().answer(pedido.id, { allow: true })
    const devolver = (responderRecurso.mock.calls[0] as unknown[])[2] as (r: typeof pedido) => void
    devolver(pedido)
    expect(useInteractions.getState().queue.map((r) => r.id)).toEqual([pedido.id])
  })

  it("o dono é a conversa do payload, mesmo sem o run casar com a conversa", () => {
    expect(ownerByRunId(pedido, { byId: {} }, { byConv: {} })).toEqual({ convId: "c-7", kind: "linear" })
  })
})
