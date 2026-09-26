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
const { avisar, startProjectBrowser, recusarPedidoDeNavegador, fila, announceArrival, appendItems } = vi.hoisted(() => {
  // A fila de verdade é um store zustand com ouvintes de Tauri no import; aqui
  // basta o contrato que os ouvintes usam: push (dedup por id), resolve, queue.
  const fila = {
    queue: [] as { id: string; kind: string; run_id?: string; data: unknown }[],
    push(req: { id: string; kind: string; run_id?: string; data: unknown }) {
      if (!fila.queue.some((r) => r.id === req.id)) fila.queue = [...fila.queue, req]
    },
    resolve(id: string) {
      fila.queue = fila.queue.filter((r) => r.id !== id)
    },
  }
  return {
    avisar: { evento: vi.fn(), erro: vi.fn(), feito: vi.fn(), fechar: vi.fn() },
    startProjectBrowser: vi.fn(async (_path: string) => ({})),
    recusarPedidoDeNavegador: vi.fn(async (_path: string) => {}),
    fila,
    announceArrival: vi.fn(),
    appendItems: vi.fn(async () => {}),
  }
})
vi.mock("@/lib/avisos", () => ({ avisar, mensagemDe: (e: unknown) => String(e) }))
vi.mock("@/lib/browser", () => ({ startProjectBrowser, recusarPedidoDeNavegador }))
const { desktopGrantRun, desktopRevokeRun, desktopRecusarPedido } = vi.hoisted(() => ({
  desktopGrantRun: vi.fn(async (_runId: string) => {}),
  desktopRevokeRun: vi.fn(async (_runId: string) => {}),
  desktopRecusarPedido: vi.fn(async (_runId: string) => {}),
}))
vi.mock("@/lib/resources", () => ({ desktopGrantRun, desktopRevokeRun, desktopRecusarPedido }))
vi.mock("@/store/app", () => ({ useApp: { getState: () => ({ projects: [{ id: "p1", name: "Frota", path: "/repo/frota" }] }) } }))
vi.mock("@/lib/work", () => ({ listenWorkEvents: (cb: (event: unknown) => void) => listenWorkEvents(cb) }))
vi.mock("@/store/chat", () => ({ useChat: { getState: () => ({ handleWorkEvent, appendItems, byId: {} }) } }))
vi.mock("@/store/interactions", () => ({ useInteractions: { getState: () => fila }, announceArrival }))

import { _resetEventosDeTrabalho, iniciarEventosDeTrabalho, pedidoDeDesktop, pedidoDeNavegador, pedidoEncerrado } from "./eventosDeTrabalho"
import { responderRecurso } from "./pedidosDeRecurso"
import { useLiberacoes } from "@/store/liberacoes"

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

  it("pedido de navegador vira cartão na conversa que pediu, com o gesto de ligar; nunca navegador sozinho", async () => {
    fila.queue = []
    startProjectBrowser.mockClear()
    pedidoDeNavegador({ kind: "browser_needed", data: { runId: "r1", convId: "c1", projectPath: "/repo/frota" } })
    expect(fila.queue).toHaveLength(1)
    const req = fila.queue[0]
    expect(req).toMatchObject({ id: "recurso:navegador:r1", kind: "recurso", run_id: "r1" })
    expect(req.data).toMatchObject({ recurso: "navegador", convId: "c1", projectPath: "/repo/frota" })
    // Chegou: sino e nativa, como qualquer pedido que para o turno.
    expect(announceArrival).toHaveBeenCalledWith(req, [])
    // Pedido não é toast (ADR-261).
    expect(avisar.evento).not.toHaveBeenCalled()
    expect(startProjectBrowser).not.toHaveBeenCalled()
    // O gesto: "Ligar navegador" responde sim.
    await responderRecurso(req as never, true, () => {})
    expect(startProjectBrowser).toHaveBeenCalledWith("/repo/frota")
  })

  it("evento de outro tipo, ou sem caminho, não pede nada", () => {
    fila.queue = []
    pedidoDeNavegador({ kind: "work_update", data: { task: { id: "p1", status: "completed" } } })
    pedidoDeNavegador({ kind: "browser_needed", data: {} })
    expect(fila.queue).toHaveLength(0)
  })

  it("o navegador ligando por qualquer caminho recolhe o pedido, sem responder", () => {
    fila.queue = []
    recusarPedidoDeNavegador.mockClear()
    pedidoDeNavegador({ kind: "browser_needed", data: { runId: "r1", convId: "c1", projectPath: "/repo/frota" } })
    pedidoDeNavegador({
      kind: "browser_state",
      data: { projectId: "p1", session: { projectId: "p1", projectPath: "/repo/frota" } as never },
    })
    expect(fila.queue).toHaveLength(0)
    expect(recusarPedidoDeNavegador).not.toHaveBeenCalled()
  })
})

// ADR-228: o agente ESPERA o gesto. ADR-261: "Agora não" é o botão da recusa;
// o cartão que sai porque o navegador ligou não é recusa. Visto no sicredi em
// 23/09/2026: o aviso dizia "o agente tenta de novo sozinho", e a pessoa teve
// de escrever "tente novamente".
describe("o pedido de ligar o navegador", () => {
  const req = (path: string) => ({
    id: `recurso:navegador:r-${path}`,
    kind: "recurso" as const,
    run_id: `r-${path}`,
    data: { recurso: "navegador" as const, convId: "c1", projectPath: path },
  })

  it("\"Agora não\" é recusa para o agente, e a decisão fica no fio", async () => {
    recusarPedidoDeNavegador.mockClear()
    appendItems.mockClear()
    await responderRecurso(req("/repo/a"), false, () => {})
    expect(recusarPedidoDeNavegador).toHaveBeenCalledWith("/repo/a")
    expect(appendItems).toHaveBeenCalledWith("c1", [
      expect.objectContaining({ kind: "notice", tom: "decisao", message: "Você preferiu não ligar o navegador do projeto." }),
    ])
  })

  it("ligar que falha devolve o pedido (o agente segue esperando) e diz o erro com a origem", async () => {
    startProjectBrowser.mockRejectedValueOnce(new Error("Chromium não encontrado"))
    avisar.erro.mockClear()
    const devolver = vi.fn()
    await responderRecurso(req("/repo/frota"), true, devolver)
    expect(devolver).toHaveBeenCalled()
    expect(avisar.erro.mock.calls[0][0]).toBe("Não consegui ligar o navegador do Frota.")
    expect(avisar.erro.mock.calls[0][1]).toMatchObject({ origem: { projeto: "/repo/frota", conversa: "c1" } })
  })

  it("quando o agente liga por autorização, a tela diz que foi ele, e de qual projeto", () => {
    avisar.evento.mockClear()
    pedidoDeNavegador({ kind: "browser_autostarted", data: { runId: "r1", convId: "c1", projectPath: "/repo/frota" } })
    expect(avisar.evento.mock.calls[0][0]).toBe("O agente ligou o navegador do Frota.")
    expect(avisar.evento.mock.calls[0][1]).toMatchObject({ origem: { projeto: "/repo/frota", conversa: "c1" } })
  })

  it("o agente que desiste de esperar tira o cartão e deixa o registro no fio", () => {
    fila.queue = []
    appendItems.mockClear()
    pedidoDeNavegador({ kind: "browser_needed", data: { runId: "r9", convId: "c1", projectPath: "/repo/frota" } })
    pedidoEncerrado({ kind: "pedido_encerrado", data: { runId: "r9", convId: "c1", recurso: "navegador" } })
    expect(fila.queue).toHaveLength(0)
    expect(appendItems).toHaveBeenCalledWith("c1", [
      expect.objectContaining({ message: "O agente deixou de esperar pelo navegador e seguiu sem ele." }),
    ])
    // Já decidido (o cartão saiu antes): nada a registrar de novo.
    appendItems.mockClear()
    pedidoEncerrado({ kind: "pedido_encerrado", data: { runId: "r9", convId: "c1", recurso: "navegador" } })
    expect(appendItems).not.toHaveBeenCalled()
  })
})

// ADR-225, correção de 22/09/2026: o Rust emitia `desktop_needed` e ninguém
// escutava; o agente ouvia "a Frota mostrou o pedido na tela" e nada aparecia.
describe("pedidoDeDesktop", () => {
  const RUN = "1ae5b180-3c53-403a-b2c4-639682128e15"

  beforeEach(() => {
    fila.queue = []
    useLiberacoes.setState({ porRun: {} })
    desktopGrantRun.mockClear()
    desktopRevokeRun.mockClear()
    desktopRecusarPedido.mockClear()
  })

  it("pedido vira cartão que espera a pessoa, e liberar é o gesto dela", async () => {
    pedidoDeDesktop({ kind: "desktop_needed", data: { runId: RUN, convId: "c1" } })
    expect(fila.queue[0]).toMatchObject({ id: `recurso:computador:${RUN}`, kind: "recurso" })
    expect(desktopGrantRun).not.toHaveBeenCalled()
    await responderRecurso(fila.queue[0] as never, true, () => {})
    expect(desktopGrantRun).toHaveBeenCalledWith(RUN)
  })

  it("liberado, o pedido sai e o Revogar fica à mão na conversa dona", () => {
    pedidoDeDesktop({ kind: "desktop_needed", data: { runId: RUN, convId: "c1" } })
    pedidoDeDesktop({ kind: "desktop_state", data: { runId: RUN, granted: true } })
    expect(fila.queue).toHaveLength(0)
    expect(useLiberacoes.getState().porRun).toEqual({ [RUN]: "c1" })
  })

  it("revogado ou turno encerrado recolhe o pedido e a faixa, sem recusar", () => {
    pedidoDeDesktop({ kind: "desktop_needed", data: { runId: RUN, convId: "c1" } })
    useLiberacoes.getState().liberar(RUN, "c1")
    pedidoDeDesktop({ kind: "desktop_state", data: { runId: RUN, convId: "c1", granted: false } })
    expect(fila.queue).toHaveLength(0)
    expect(useLiberacoes.getState().porRun).toEqual({})
    expect(desktopRecusarPedido).not.toHaveBeenCalled()
  })

  // ADR-242, 24/09/2026: "eu liberei, aceitei", e o agente já tinha ouvido
  // "não liberado". A tool espera o gesto; "Agora não" é a resposta.
  it("\"Agora não\" vira recusa para o agente", async () => {
    pedidoDeDesktop({ kind: "desktop_needed", data: { runId: "run-z", convId: "c1" } })
    await responderRecurso(fila.queue[0] as never, false, () => {})
    expect(desktopRecusarPedido).toHaveBeenCalledWith("run-z")
  })

  it("evento sem run, ou de outro tipo, não mexe na tela", () => {
    pedidoDeDesktop({ kind: "desktop_needed", data: {} })
    pedidoDeDesktop({ kind: "browser_needed", data: { runId: RUN, projectPath: "/repo/frota" } })
    expect(fila.queue).toHaveLength(0)
    expect(useLiberacoes.getState().porRun).toEqual({})
  })
})
