import { beforeEach, describe, expect, it, vi } from "vitest"

const estado = vi.hoisted(() => ({
  app: {
    projects: [{ id: "847bbc6b-df74-454e-a2c1-62fd07bc059e", name: "sicredi", path: "/Users/me/projetos/sicredi" }],
    activeProjectId: "847bbc6b-df74-454e-a2c1-62fd07bc059e" as string | null,
    mainTab: { kind: "conversa" } as { kind: string },
    openBrowserTab: vi.fn(),
    showBrowserTab: vi.fn(),
  },
  chat: { activeId: "407b66b2-68e8-48f6-aba5-9b7bd0ae38a2" as string | null },
  flutuando: {} as Record<string, true>,
}))
vi.mock("@/store/app", () => ({ useApp: { getState: () => estado.app } }))
vi.mock("@/store/chat", () => ({ useChat: { getState: () => estado.chat } }))
vi.mock("@/store/navegadorFlutuante", () => ({
  useNavegadorFlutuante: { getState: () => ({ flutuando: estado.flutuando }) },
}))

import type { WorkEvent } from "@/lib/work"
import { _resetNavegadorAoVivo, vistaDoAgenteNoNavegador } from "./navegadorAoVivo"

const SICREDI = "847bbc6b-df74-454e-a2c1-62fd07bc059e"
const CONVERSA = "407b66b2-68e8-48f6-aba5-9b7bd0ae38a2"

// Forma do evento que o gateway emite (browser_gateway.rs), com os ids da
// conversa do sicredi de 23/09/2026 em que o navegador não abriu.
function usou(runId = "r-1", convId = CONVERSA): WorkEvent {
  return { kind: "browser_agent_active", data: { runId, convId, projectPath: "/Users/me/projetos/sicredi" } }
}
const semDigitar = () => false

beforeEach(() => {
  _resetNavegadorAoVivo()
  estado.app.openBrowserTab.mockClear()
  estado.app.showBrowserTab.mockClear()
  estado.app.activeProjectId = SICREDI
  estado.app.mainTab = { kind: "conversa" }
  estado.chat.activeId = CONVERSA
  estado.flutuando = {}
})

describe("a aba Navegador abre quando o agente usa o navegador", () => {
  it("o agente usou o navegador na conversa da tela: a aba Navegador abre e vem para a frente", () => {
    vistaDoAgenteNoNavegador(usou(), semDigitar)
    expect(estado.app.openBrowserTab).toHaveBeenCalledTimes(1)
    expect(estado.app.showBrowserTab).not.toHaveBeenCalled()
  })

  it("uma vez por turno: a pessoa voltou para a conversa, o próximo clique do agente não a tira de lá", () => {
    vistaDoAgenteNoNavegador(usou(), semDigitar)
    vistaDoAgenteNoNavegador(usou(), semDigitar)
    expect(estado.app.openBrowserTab).toHaveBeenCalledTimes(1)
    vistaDoAgenteNoNavegador(usou("r-2"), semDigitar)
    expect(estado.app.openBrowserTab).toHaveBeenCalledTimes(2)
  })

  it("com a pessoa digitando, a aba entra na tira mas não rouba a tela", () => {
    vistaDoAgenteNoNavegador(usou(), () => true)
    expect(estado.app.openBrowserTab).not.toHaveBeenCalled()
    expect(estado.app.showBrowserTab).toHaveBeenCalledTimes(1)
  })

  it("com um arquivo ou o diff à vista, a aba entra na tira e espera o clique", () => {
    estado.app.mainTab = { kind: "diff" }
    vistaDoAgenteNoNavegador(usou(), semDigitar)
    expect(estado.app.openBrowserTab).not.toHaveBeenCalled()
    expect(estado.app.showBrowserTab).toHaveBeenCalledTimes(1)
  })

  it("a janela flutuante é escolha da pessoa: se ela já está vendo por lá, nada muda", () => {
    estado.flutuando = { [SICREDI]: true }
    vistaDoAgenteNoNavegador(usou(), semDigitar)
    expect(estado.app.openBrowserTab).not.toHaveBeenCalled()
    expect(estado.app.showBrowserTab).not.toHaveBeenCalled()
  })

  it("quem está em outra conversa não é interrompido, e a aba abre quando ela voltar", () => {
    estado.chat.activeId = "outra"
    vistaDoAgenteNoNavegador(usou(), semDigitar)
    expect(estado.app.openBrowserTab).not.toHaveBeenCalled()
    estado.chat.activeId = CONVERSA
    vistaDoAgenteNoNavegador(usou(), semDigitar)
    expect(estado.app.openBrowserTab).toHaveBeenCalledTimes(1)
  })

  it("outro projeto na tela: nada abre", () => {
    estado.app.activeProjectId = "outro"
    vistaDoAgenteNoNavegador(usou(), semDigitar)
    expect(estado.app.openBrowserTab).not.toHaveBeenCalled()
    expect(estado.app.showBrowserTab).not.toHaveBeenCalled()
  })

  it("já na aba Navegador: nada muda, nem depois de sair dela no mesmo turno", () => {
    estado.app.mainTab = { kind: "navegador" }
    vistaDoAgenteNoNavegador(usou(), semDigitar)
    estado.app.mainTab = { kind: "conversa" }
    vistaDoAgenteNoNavegador(usou(), semDigitar)
    expect(estado.app.openBrowserTab).not.toHaveBeenCalled()
  })

  it("outros eventos do canal não abrem nada", () => {
    vistaDoAgenteNoNavegador({ kind: "browser_needed", data: { runId: "r-1", projectPath: "/Users/me/projetos/sicredi" } }, semDigitar)
    expect(estado.app.openBrowserTab).not.toHaveBeenCalled()
  })
})
