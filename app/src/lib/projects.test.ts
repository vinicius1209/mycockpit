import { beforeEach, describe, expect, it, vi } from "vitest"
import { createProject, addProjectViaDialog } from "./projects"
import { useApp } from "@/store/app"
import * as db from "@/lib/db"

vi.mock("@/lib/db", () => ({
  isTauri: () => true,
  insertProject: vi.fn(async () => true),
  findProjectByPath: vi.fn(async () => null),
  restoreProject: vi.fn(async () => {}),
  renameProject: vi.fn(async () => {}),
  setProjectColor: vi.fn(async () => {}),
  listProjects: vi.fn(async () => []),
}))

describe("projects lib", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useApp.setState({
      projects: [],
      activeProjectId: null,
      addProjectOpen: false,
    })
  })

  it("addProjectViaDialog abre o modal no app store", () => {
    expect(useApp.getState().addProjectOpen).toBe(false)
    addProjectViaDialog()
    expect(useApp.getState().addProjectOpen).toBe(true)
  })

  it("createProject recusa caminho vazio", async () => {
    const res = await createProject({ name: "Meu Projeto", path: "   " })
    expect(res).toBeNull()
    expect(db.insertProject).not.toHaveBeenCalled()
  })

  it("createProject deriva nome da pasta se nome vier vazio", async () => {
    const res = await createProject({
      name: "",
      path: "/Users/dev/projetos/meu-cockpit",
      color: "#34d399",
    })

    expect(res).not.toBeNull()
    expect(res?.name).toBe("meu-cockpit")
    expect(res?.path).toBe("/Users/dev/projetos/meu-cockpit")
    expect(res?.color).toBe("#34d399")
    expect(db.insertProject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "meu-cockpit",
        path: "/Users/dev/projetos/meu-cockpit",
        color: "#34d399",
      }),
    )
    expect(useApp.getState().projects).toHaveLength(1)
    expect(useApp.getState().activeProjectId).toBe(res?.id)
  })

  it("createProject preserva nome customizado e cor escolhida", async () => {
    const res = await createProject({
      name: "Cockpit Dashboard",
      path: "/Users/dev/projetos/meu-cockpit",
      color: "#f87171",
    })

    expect(res).not.toBeNull()
    expect(res?.name).toBe("Cockpit Dashboard")
    expect(res?.color).toBe("#f87171")
    expect(db.insertProject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Cockpit Dashboard",
        color: "#f87171",
      }),
    )
  })

  it("createProject lida com projeto existente restaurando e atualizando", async () => {
    vi.mocked(db.insertProject).mockResolvedValueOnce(false)
    vi.mocked(db.findProjectByPath).mockResolvedValueOnce({
      id: "p-existing",
      deleted: true,
    })
    vi.mocked(db.listProjects).mockResolvedValueOnce([
      {
        id: "p-existing",
        name: "Cockpit Antigo",
        path: "/Users/dev/projetos/meu-cockpit",
        createdAt: 1000,
        color: "#f87171",
      },
    ])

    const res = await createProject({
      name: "Cockpit Renomeado",
      path: "/Users/dev/projetos/meu-cockpit",
      color: "#f87171",
    })

    expect(db.restoreProject).toHaveBeenCalledWith("p-existing")
    expect(db.setProjectColor).toHaveBeenCalledWith("p-existing", "#f87171")
    expect(db.renameProject).toHaveBeenCalledWith("p-existing", "Cockpit Renomeado")
    expect(useApp.getState().activeProjectId).toBe("p-existing")
    expect(res?.id).toBe("p-existing")
  })
})

describe("os dois defeitos que o review pegou", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useApp.setState({ projects: [], activeProjectId: null, addProjectOpen: false })
  })

  it("banco que não gravou NÃO vira projeto na tela", async () => {
    // `insertProject` devolve false quando não há banco (db.ts). Antes, o
    // código caía no caminho feliz: metia o projeto na store, dizia "Projeto
    // adicionado" — e ele evaporava no restart. Justamente o id fantasma que o
    // `findProjectByPath` existe pra evitar.
    vi.mocked(db.insertProject).mockResolvedValueOnce(false)
    vi.mocked(db.findProjectByPath).mockResolvedValueOnce(null)

    const res = await createProject({ name: "X", path: "/tmp/x" })

    expect(res).toBeNull()
    expect(useApp.getState().projects).toHaveLength(0)
    expect(useApp.getState().activeProjectId).toBeNull()
  })

  it("re-adicionar sem escolher cor PRESERVA a cor do projeto", async () => {
    // O diálogo nasce sem cor escolhida. Com a guarda antiga (`color !==
    // undefined`, sempre verdadeira porque `color` já tinha caído pra `null`),
    // só abrir e confirmar apagava a cor que estava lá.
    vi.mocked(db.insertProject).mockResolvedValueOnce(false)
    vi.mocked(db.findProjectByPath).mockResolvedValueOnce({
      id: "p1",
      deleted: false,
    })
    vi.mocked(db.listProjects).mockResolvedValueOnce([])

    await createProject({ name: "", path: "/tmp/x" })

    expect(db.setProjectColor).not.toHaveBeenCalled()
  })

  it("escolher 'sem cor' explicitamente AINDA limpa a cor", async () => {
    // A distinção que faz a guarda acima ser correta e não preguiçosa:
    // `undefined` é "não mexi", `null` é "quero sem cor".
    vi.mocked(db.insertProject).mockResolvedValueOnce(false)
    vi.mocked(db.findProjectByPath).mockResolvedValueOnce({
      id: "p1",
      deleted: false,
    })
    vi.mocked(db.listProjects).mockResolvedValueOnce([])

    await createProject({ name: "", path: "/tmp/x", color: null })

    expect(db.setProjectColor).toHaveBeenCalledWith("p1", null)
  })
})

describe("a pasta precisa existir", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useApp.setState({ projects: [], activeProjectId: null, addProjectOpen: false })
  })

  it("fora do Tauri a checagem não bloqueia (não sei ≠ quebrado)", async () => {
    // `conferirPastas` devolve {} sem backend. Se isso barrasse a criação, o
    // app não conseguiria cadastrar projeto nenhum em teste/dev web.
    const res = await createProject({ name: "X", path: "/tmp/x" })
    expect(res).not.toBeNull()
    expect(db.insertProject).toHaveBeenCalled()
  })
})
