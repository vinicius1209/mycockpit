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
const { toast, startProjectBrowser, recusarPedidoDeNavegador } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
  startProjectBrowser: vi.fn(async (_path: string) => ({})),
  recusarPedidoDeNavegador: vi.fn(async (_path: string) => {}),
}))
vi.mock("sonner", () => ({ toast }))
vi.mock("@/lib/browser", () => ({ startProjectBrowser, recusarPedidoDeNavegador }))
const { desktopGrantRun, desktopRevokeRun, desktopRecusarPedido } = vi.hoisted(() => ({
  desktopGrantRun: vi.fn(async (_runId: string) => {}),
  desktopRevokeRun: vi.fn(async (_runId: string) => {}),
  desktopRecusarPedido: vi.fn(async (_runId: string) => {}),
}))
vi.mock("@/lib/resources", () => ({ desktopGrantRun, desktopRevokeRun, desktopRecusarPedido }))
vi.mock("@/store/app", () => ({ useApp: { getState: () => ({ projects: [{ id: "p1", name: "Frota", path: "/repo/frota" }] }) } }))
vi.mock("@/lib/work", () => ({ listenWorkEvents: (cb: (event: unknown) => void) => listenWorkEvents(cb) }))
vi.mock("@/store/chat", () => ({ useChat: { getState: () => ({ handleWorkEvent }) } }))

import { _resetEventosDeTrabalho, iniciarEventosDeTrabalho, pedidoDeDesktop, pedidoDeNavegador } from "./eventosDeTrabalho"

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

// ADR-228: o agente ESPERA o gesto. Fechar o aviso é recusa; o aviso que sai
// porque o navegador ligou, não. Visto no sicredi em 23/09/2026: o aviso dizia
// "o agente tenta de novo sozinho", e a pessoa teve de escrever "tente
// novamente".
describe("o aviso de ligar o navegador", () => {
  type Opcoes = { description: string; onDismiss: () => void; action: { onClick: () => void } }
  const pedido = (path: string) =>
    pedidoDeNavegador({ kind: "browser_needed", data: { runId: "r1", convId: "c1", projectPath: path } })
  const opcoes = () => toast.mock.calls.at(-1)![1] as Opcoes

  it("diz que o agente está esperando, não que ele tenta sozinho", () => {
    pedido("/repo/frota")
    expect(opcoes().description).toContain("o agente está esperando")
    expect(opcoes().description).not.toContain("tenta de novo sozinho")
  })

  it("fechar o aviso sem ligar vira recusa para o agente", () => {
    recusarPedidoDeNavegador.mockClear()
    pedido("/repo/a")
    opcoes().onDismiss()
    expect(recusarPedidoDeNavegador).toHaveBeenCalledWith("/repo/a")
  })

  it("o aviso que sai porque o navegador ligou não é recusa", () => {
    recusarPedidoDeNavegador.mockClear()
    pedido("/repo/b")
    const { onDismiss } = opcoes()
    pedidoDeNavegador({ kind: "browser_state", data: { session: { projectPath: "/repo/b" } as never } })
    onDismiss()
    expect(recusarPedidoDeNavegador).not.toHaveBeenCalled()
    // Clicar em "Ligar navegador" também não.
    pedido("/repo/c")
    const c = opcoes()
    c.action.onClick()
    c.onDismiss()
    expect(recusarPedidoDeNavegador).not.toHaveBeenCalled()
  })

  it("quando o agente liga por autorização, a tela diz que foi ele", () => {
    toast.mockClear()
    pedidoDeNavegador({ kind: "browser_autostarted", data: { runId: "r1", projectPath: "/repo/frota" } })
    expect(toast.mock.calls[0][0]).toBe("O agente ligou o navegador do projeto Frota.")
  })
})

// ADR-225, correção de 22/09/2026: o Rust emitia `desktop_needed` e ninguém
// escutava; o agente ouvia "a Frota mostrou o pedido na tela" e nada aparecia.
describe("pedidoDeDesktop", () => {
  type Opcoes = { id: string; duration: number; action: { label: string; onClick: () => void } }
  const RUN = "1ae5b180-3c53-403a-b2c4-639682128e15"

  beforeEach(() => {
    toast.mockClear()
    toast.dismiss.mockClear()
    desktopGrantRun.mockClear()
    desktopRevokeRun.mockClear()
  })

  it("pedido vira aviso que espera a pessoa, e liberar é o gesto dela", () => {
    pedidoDeDesktop({ kind: "desktop_needed", data: { runId: RUN, convId: "c1" } })
    expect(toast).toHaveBeenCalledTimes(1)
    const opcoes = toast.mock.calls[0][1] as Opcoes
    expect(opcoes.id).toBe(`desktop-needed:${RUN}`)
    expect(opcoes.duration).toBe(Infinity)
    expect(desktopGrantRun).not.toHaveBeenCalled()
    expect(opcoes.action.label).toBe("Liberar neste turno")
    opcoes.action.onClick()
    expect(desktopGrantRun).toHaveBeenCalledWith(RUN)
  })

  it("liberado, o pedido sai e o Revogar fica à mão", () => {
    pedidoDeDesktop({ kind: "desktop_state", data: { runId: RUN, granted: true } })
    expect(toast.dismiss).toHaveBeenCalledWith(`desktop-needed:${RUN}`)
    const opcoes = toast.mock.calls[0][1] as Opcoes
    expect(opcoes.id).toBe(`desktop-granted:${RUN}`)
    expect(opcoes.action.label).toBe("Revogar")
    opcoes.action.onClick()
    expect(desktopRevokeRun).toHaveBeenCalledWith(RUN)
  })

  it("revogado ou turno encerrado recolhe os dois avisos", () => {
    pedidoDeDesktop({ kind: "desktop_state", data: { runId: RUN, convId: "c1", granted: false } })
    expect(toast).not.toHaveBeenCalled()
    expect(toast.dismiss).toHaveBeenCalledWith(`desktop-needed:${RUN}`)
    expect(toast.dismiss).toHaveBeenCalledWith(`desktop-granted:${RUN}`)
  })

  // ADR-242, 24/09/2026: "eu liberei, aceitei", e o agente já tinha ouvido
  // "não liberado". Agora a tool espera o gesto; fechar o aviso é a resposta.
  it("diz que o agente está esperando, e fechar sem liberar vira recusa", () => {
    desktopRecusarPedido.mockClear()
    pedidoDeDesktop({ kind: "desktop_needed", data: { runId: "run-z", convId: "c1" } })
    const opcoes = toast.mock.calls[0][1] as Opcoes & { description: string; onDismiss: () => void }
    expect(opcoes.description).toContain("Ele está esperando")
    opcoes.onDismiss()
    expect(desktopRecusarPedido).toHaveBeenCalledWith("run-z")
  })

  it("o aviso que sai por liberação ou fim do turno não é recusa", () => {
    desktopRecusarPedido.mockClear()
    pedidoDeDesktop({ kind: "desktop_needed", data: { runId: "run-a", convId: "c1" } })
    const a = toast.mock.calls.at(-1)![1] as Opcoes & { onDismiss: () => void }
    a.action.onClick()
    a.onDismiss()
    pedidoDeDesktop({ kind: "desktop_needed", data: { runId: "run-b", convId: "c1" } })
    const b = toast.mock.calls.at(-1)![1] as Opcoes & { onDismiss: () => void }
    pedidoDeDesktop({ kind: "desktop_state", data: { runId: "run-b", granted: false } })
    b.onDismiss()
    expect(desktopRecusarPedido).not.toHaveBeenCalled()
  })

  it("evento sem run, ou de outro tipo, não mexe na tela", () => {
    pedidoDeDesktop({ kind: "desktop_needed", data: {} })
    pedidoDeDesktop({ kind: "browser_needed", data: { runId: RUN, projectPath: "/repo/frota" } })
    expect(toast).not.toHaveBeenCalled()
    expect(toast.dismiss).not.toHaveBeenCalled()
  })
})
