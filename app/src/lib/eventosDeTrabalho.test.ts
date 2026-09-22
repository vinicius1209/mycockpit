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
const { toast, startProjectBrowser } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
  startProjectBrowser: vi.fn(async (_path: string) => ({})),
}))
vi.mock("sonner", () => ({ toast }))
vi.mock("@/lib/browser", () => ({ startProjectBrowser }))
vi.mock("@/store/app", () => ({ useApp: { getState: () => ({ projects: [{ id: "p1", name: "Frota", path: "/repo/frota" }] }) } }))
vi.mock("@/lib/work", () => ({ listenWorkEvents: (cb: (event: unknown) => void) => listenWorkEvents(cb) }))
vi.mock("@/store/chat", () => ({ useChat: { getState: () => ({ handleWorkEvent }) } }))

import { _resetEventosDeTrabalho, iniciarEventosDeTrabalho, pedidoDeNavegador } from "./eventosDeTrabalho"

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

  it("pedido de navegador vira aviso com o gesto de ligar, nunca navegador sozinho", async () => {
    toast.mockClear()
    startProjectBrowser.mockClear()
    pedidoDeNavegador({ kind: "browser_needed", data: { runId: "r1", convId: "c1", projectPath: "/repo/frota" } })
    expect(toast).toHaveBeenCalledTimes(1)
    const [texto, opcoes] = toast.mock.calls[0] as [string, { duration: number; action: { label: string; onClick: () => void } }]
    expect(texto).toContain("Frota")
    // Decisão humana pendente não expira sozinha (22/09/2026: com 30 s o
    // aviso sumia antes de a pessoa olhar).
    expect(opcoes.duration).toBe(Infinity)
    expect(startProjectBrowser).not.toHaveBeenCalled()
    expect(opcoes.action.label).toBe("Ligar navegador")
    opcoes.action.onClick()
    expect(startProjectBrowser).toHaveBeenCalledWith("/repo/frota")
  })

  it("evento de outro tipo, ou sem caminho, não avisa", () => {
    toast.mockClear()
    pedidoDeNavegador({ kind: "work_update", data: { task: { id: "p1", status: "completed" } } })
    pedidoDeNavegador({ kind: "browser_needed", data: {} })
    expect(toast).not.toHaveBeenCalled()
  })

  it("o navegador ligando por qualquer caminho recolhe o pedido", () => {
    toast.dismiss.mockClear()
    pedidoDeNavegador({
      kind: "browser_state",
      data: { projectId: "p1", session: { projectId: "p1", projectPath: "/repo/frota" } as never },
    })
    expect(toast.dismiss).toHaveBeenCalledWith("browser-needed:/repo/frota")
  })
})
