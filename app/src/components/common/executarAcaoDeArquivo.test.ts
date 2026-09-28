import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ invokes: [] as { cmd: string; args: unknown }[], copiado: [] as string[] }))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: unknown) => {
    h.invokes.push({ cmd, args })
  }),
}))
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn(async () => {}) }))
vi.mock("@/lib/clipboard", () => ({
  copyText: vi.fn(async (t: string) => {
    h.copiado.push(t)
    return true
  }),
}))
vi.mock("@/lib/focusComposer", () => ({ focusConsoleComposer: vi.fn() }))
vi.mock("@/lib/db/conversationDrafts", () => ({
  loadComposerDraft: vi.fn(async () => null),
  saveComposerDraft: vi.fn(async () => {}),
  deleteComposerDraft: vi.fn(async () => {}),
}))

import { citarNoComposer, executarAcaoDeArquivo } from "./executarAcaoDeArquivo"
import { useChat } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"

const RAIZ = "/Users/v/projetos/frota"

beforeEach(() => {
  h.invokes.length = 0
  h.copiado.length = 0
  useChat.setState({ activeId: "c1" })
  useComposerDrafts.setState({ byConv: {}, loaded: {} })
})

describe("os efeitos do menu de arquivo", () => {
  it("citar vira o cartão do arrasto, com o caminho absoluto, sem repetir", () => {
    citarNoComposer(RAIZ, [{ rel: "docs/PLAN.md", pasta: false }, { rel: "docs", pasta: true }])
    citarNoComposer(RAIZ, [{ rel: "docs/PLAN.md", pasta: false }])
    const blocos = useComposerDrafts.getState().byConv.c1?.blocos ?? []
    expect(blocos.map((b) => (b.tipo === "arquivo" ? [b.caminho, b.pasta] : b.tipo))).toEqual([
      [`${RAIZ}/docs/PLAN.md`, false],
      [`${RAIZ}/docs`, true],
    ])
  })

  it("copiar o caminho completo junta a raiz, e copiar vários põe um por linha", async () => {
    await executarAcaoDeArquivo("copiar-caminho-completo", { tipo: "arquivo", rel: "docs/PLAN.md" }, { root: `${RAIZ}/` })
    await executarAcaoDeArquivo(
      "copiar-caminhos",
      { tipo: "varios", itens: [{ rel: "a.md", pasta: false }, { rel: "docs", pasta: true }] },
      { root: RAIZ },
    )
    expect(h.copiado).toEqual([`${RAIZ}/docs/PLAN.md`, "a.md\ndocs"])
  })

  it("abrir no app padrão passa pela raiz, para o Rust conter o caminho", async () => {
    await executarAcaoDeArquivo("abrir-no-app", { tipo: "arquivo", rel: "docs/print.png" }, { root: RAIZ })
    expect(h.invokes).toEqual([{ cmd: "abrir_no_app_padrao", args: { root: RAIZ, rel: "docs/print.png" } }])
  })
})

describe("citar pelo ⌘↵ da árvore", () => {
  it("deixa a tela onde está: o cartão no rascunho é o retorno", async () => {
    const { useApp } = await import("@/store/app")
    useApp.setState({ mainTab: { kind: "arquivo", path: "docs/PLAN.md" } })
    citarNoComposer(RAIZ, [{ rel: "docs/PLAN.md", pasta: false }], { focar: false })
    expect(useApp.getState().mainTab).toEqual({ kind: "arquivo", path: "docs/PLAN.md" })
    expect(useComposerDrafts.getState().byConv.c1?.blocos).toHaveLength(1)
  })
})
