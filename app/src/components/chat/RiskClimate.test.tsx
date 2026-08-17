// O CLIMA ACENDE PELO MODO CERTO, DA CONVERSA CERTA.
//
// `lib/climate` já é puro e testado — a regra de QUANDO acender não está em
// dúvida. O que não tinha teste nenhum era a LIGAÇÃO: de qual projeto sai o
// modo, o que acontece ao trocar de conversa, e se a precedência do
// `.mycockpit/config.toml` vale também aqui. Uma ligação errada acende a
// moldura de "o agente muda sem pedir" na conversa errada — ou, pior, não a
// acende na certa.
//
// SSR (`renderToStaticMarkup`) com os três stores mockados: o zustand v5 em SSR
// devolve `getInitialState()` (medido), e o `useAwaiting` usa
// `useSyncExternalStore` sem `getServerSnapshot`, que nem monta no servidor.
// Mockar é o que torna o estado observável; a regra continua sendo lida do
// componente de verdade.
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PermissionMode, Project } from "@/lib/types"
import type { ProjectConfig } from "@/store/app"

const PROJ_QUENTE = "9d0f2f7a-6f4a-4b0e-9c6f-2b1d4a55c101"
const PROJ_FRIO = "f2c1a3d4-1111-4444-8888-aaaabbbbcccc"
const CONV_QUENTE = "6f1c8b90-0e2a-4b77-9a55-8b2f1c0d3e44"
const CONV_FRIA = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"

const app: { projects: Project[]; mycockpit: Record<string, ProjectConfig> } = {
  projects: [],
  mycockpit: {},
}
const chat: { activeId: string | null; byId: Record<string, { projectId: string }> } = {
  activeId: null,
  byId: {},
}
let esperando = new Set<string>()

vi.mock("@/store/app", () => ({
  useApp: (seletor: (s: typeof app) => unknown) => seletor(app),
}))
vi.mock("@/store/chat", () => ({
  useChat: (seletor: (s: typeof chat) => unknown) => seletor(chat),
}))
vi.mock("@/store/interactions", () => ({
  useAwaiting: () => ({ convIds: esperando }),
}))

const { RiskClimate } = await import("@/components/chat/RiskClimate")
const { CLIMATE_FRAME_CLASS } = await import("@/lib/climate")

function projeto(id: string, cache: PermissionMode | undefined): Project {
  return {
    id,
    name: id === PROJ_QUENTE ? "mycockpit" : "mypeople",
    path: `/Users/dev/projetos/${id === PROJ_QUENTE ? "mycockpit" : "mypeople"}`,
    createdAt: 1_752_700_000_000,
    permissionMode: cache,
  }
}

function config(permission: PermissionMode): ProjectConfig {
  return { exists: true, permission, helper: "haiku", mode: "linear", extraDirs: [] }
}

/** O clima está aceso? (o componente devolve `null` quando não). */
function aceso(): boolean {
  const html = renderToStaticMarkup(<RiskClimate />)
  if (html === "") return false
  expect(html).toContain(CLIMATE_FRAME_CLASS)
  return true
}

beforeEach(() => {
  app.projects = [projeto(PROJ_QUENTE, "liberado"), projeto(PROJ_FRIO, "padrao")]
  app.mycockpit = {}
  chat.byId = {
    [CONV_QUENTE]: { projectId: PROJ_QUENTE },
    [CONV_FRIA]: { projectId: PROJ_FRIO },
  }
  chat.activeId = CONV_QUENTE
  esperando = new Set()
})

describe("só o modo perigoso acende a tela", () => {
  it("Liberado acende", () => {
    expect(aceso()).toBe(true)
  })

  it("Pede não acende", () => {
    app.projects = [projeto(PROJ_QUENTE, "padrao"), projeto(PROJ_FRIO, "padrao")]
    expect(aceso()).toBe(false)
  })

  it("Só lê não acende (sinal que acende sempre não é sinal)", () => {
    app.projects = [projeto(PROJ_QUENTE, "leitura"), projeto(PROJ_FRIO, "padrao")]
    expect(aceso()).toBe(false)
  })

  it("sem conversa aberta não há próximo turno pra avisar", () => {
    chat.activeId = null
    expect(aceso()).toBe(false)
  })

  it("o .mycockpit/config.toml manda aqui também", () => {
    // cache diz "padrao", o arquivo diz "liberado" → o Rust vai spawnar
    // liberado, então a tela TEM de avisar.
    app.projects = [projeto(PROJ_QUENTE, "padrao"), projeto(PROJ_FRIO, "padrao")]
    app.mycockpit = { [PROJ_QUENTE]: config("liberado") }
    expect(aceso()).toBe(true)
  })

  it("o arquivo também APAGA o clima quando o cache está desatualizado", () => {
    // O lado que importa mais: cache "liberado" com o arquivo em "leitura" não
    // pode deixar a moldura acesa — seria alarme falso permanente.
    app.mycockpit = { [PROJ_QUENTE]: config("leitura") }
    expect(aceso()).toBe(false)
  })
})

describe("o clima é da conversa ATIVA, e troca junto com ela", () => {
  it("trocar de conversa NÃO carrega o modo da anterior", () => {
    // Mesma família do bug do `destination` do composer sobrevivendo à troca de
    // conversa: aqui o preço seria a moldura de perigo ficar acesa num fio que
    // roda em "Pede" (ou apagar num que roda liberado).
    expect(aceso()).toBe(true)
    chat.activeId = CONV_FRIA
    expect(aceso()).toBe(false)
    chat.activeId = CONV_QUENTE
    expect(aceso()).toBe(true)
  })

  it("conversa ainda não hidratada (janela do switch) não acende nada", () => {
    chat.activeId = "conversa-que-ainda-nao-veio-do-disco"
    expect(aceso()).toBe(false)
  })

  it("conversa órfã (projeto removido) não acende", () => {
    app.projects = [projeto(PROJ_FRIO, "padrao")]
    expect(aceso()).toBe(false)
  })
})

describe("âmbar de decisão ganha do clima", () => {
  it("com pedido esperando VOCÊ, o clima recolhe", () => {
    esperando = new Set([CONV_QUENTE])
    expect(aceso()).toBe(false)
  })

  it("pedido pendente em OUTRA conversa não apaga o clima desta", () => {
    esperando = new Set([CONV_FRIA])
    expect(aceso()).toBe(true)
  })
})
