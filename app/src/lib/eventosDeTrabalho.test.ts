// Incidente de 21/09/2026: a escuta morava no ChatPanel, a árvore do React caiu
// e cinco `work_update` aceitos pelo gateway nunca viraram item do fio.
import { beforeEach, describe, expect, it, vi } from "vitest"

const handleWorkEvent = vi.fn()
let entregar: ((event: unknown) => void) | null = null
const listenWorkEvents = vi.fn(async (onEvent: (event: unknown) => void) => {
  entregar = onEvent
  return () => {}
})

vi.mock("@/lib/db", () => ({ isTauri: () => true }))
vi.mock("@/lib/work", () => ({ listenWorkEvents: (cb: (event: unknown) => void) => listenWorkEvents(cb) }))
vi.mock("@/store/chat", () => ({ useChat: { getState: () => ({ handleWorkEvent }) } }))

import { _resetEventosDeTrabalho, iniciarEventosDeTrabalho } from "./eventosDeTrabalho"

beforeEach(() => {
  _resetEventosDeTrabalho()
  handleWorkEvent.mockClear()
  listenWorkEvents.mockClear()
  entregar = null
})

describe("iniciarEventosDeTrabalho", () => {
  it("liga a escuta uma vez só, por mais que o boot chame", () => {
    iniciarEventosDeTrabalho()
    iniciarEventosDeTrabalho()
    expect(listenWorkEvents).toHaveBeenCalledTimes(1)
  })

  it("entrega o evento ao store sem depender de nenhum componente montado", async () => {
    iniciarEventosDeTrabalho()
    await Promise.resolve()
    // Payload real do fio de 21/09/2026 (o update que se perdeu às 18:22:51).
    const evento = {
      kind: "work_update",
      data: { runId: "1ae5b180-3c53-403a-b2c4-639682128e15", task: { id: "p2", status: "completed" } },
    }
    entregar?.(evento)
    expect(handleWorkEvent).toHaveBeenCalledWith(evento)
  })

  it("falha ao ligar vai pro log e permite nova tentativa", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {})
    listenWorkEvents.mockRejectedValueOnce(new Error("sem ponte"))
    iniciarEventosDeTrabalho()
    await Promise.resolve()
    await Promise.resolve()
    expect(erro).toHaveBeenCalled()
    iniciarEventosDeTrabalho()
    expect(listenWorkEvents).toHaveBeenCalledTimes(2)
    erro.mockRestore()
  })
})
