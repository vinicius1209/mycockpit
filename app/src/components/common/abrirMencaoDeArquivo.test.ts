// Clique numa menção de arquivo no fio. Caso real de 14/09/2026: a resposta
// citou `dialog-centralizado.spec.ts` (sem pasta), o clique procurou na raiz do
// projeto e morreu em "não achei". O arquivo real está em `app/e2e/`.
import { beforeEach, describe, expect, it, vi } from "vitest"

const busca = vi.hoisted(() => ({ entradas: [] as { relPath: string; kind: "file" | "directory" }[], falha: false }))
const avisos = vi.hoisted(() => ({ erro: [] as string[], info: [] as string[] }))

vi.mock("@/lib/projectFilesService", () => ({
  searchProjectFileIndex: vi.fn(async () => {
    if (busca.falha) throw new Error("git indisponível")
    return { page: { entries: busca.entradas }, cache: "miss", generation: 1 }
  }),
}))
vi.mock("sonner", () => ({
  toast: Object.assign((m: string) => avisos.info.push(m), { error: (m: string) => avisos.erro.push(m) }),
}))

import { useApp } from "@/store/app"
import { emptyConv, useChat } from "@/store/chat"
import { useMarkdownViewer } from "@/store/markdownViewer"
import { abrirMencaoDeArquivo } from "./abrirMencaoDeArquivo"

const PROJETO = "/Users/viniciusmachado/projetos/mycockpit"
const abertos: string[] = []

describe("clique numa menção de arquivo abre dentro do Frota", () => {
  beforeEach(() => {
    abertos.length = 0
    avisos.erro.length = 0
    avisos.info.length = 0
    busca.entradas = []
    busca.falha = false
    useApp.setState({ openFileTab: (path: string) => abertos.push(path) } as never)
    useChat.setState((s) => ({
      activeId: "c1",
      projectId: "p1",
      conversations: [],
      byId: { ...s.byId, c1: { ...emptyConv("p1"), items: [] } },
    }))
  })

  it("caminho com pasta abre direto na aba do explorador", async () => {
    await abrirMencaoDeArquivo({ rel: "app/e2e/dialog-centralizado.spec.ts", line: null }, PROJETO)
    expect(abertos).toEqual(["app/e2e/dialog-centralizado.spec.ts"])
  })

  it("nome solto é procurado no projeto e abre o único que casa", async () => {
    busca.entradas = [
      { relPath: "app/e2e/dialog-centralizado.spec.ts", kind: "file" },
      { relPath: "app/e2e/dialog-centralizado.spec.ts.snap", kind: "file" },
      { relPath: "app/e2e", kind: "directory" },
    ]
    await abrirMencaoDeArquivo({ rel: "dialog-centralizado.spec.ts", line: null }, PROJETO)
    expect(abertos).toEqual(["app/e2e/dialog-centralizado.spec.ts"])
    expect(avisos.erro).toEqual([])
  })

  it("arquivo que a conversa tocou vence a busca, sem depender do índice", async () => {
    useChat.setState((s) => ({
      byId: {
        ...s.byId,
        c1: {
          ...emptyConv("p1"),
          items: [{ kind: "tool", id: "t1", name: "Edit", input: { file_path: `${PROJETO}/app/e2e/dialog-centralizado.spec.ts` } } as never],
        },
      },
    }))
    busca.falha = true
    await abrirMencaoDeArquivo({ rel: "dialog-centralizado.spec.ts", line: null }, PROJETO)
    expect(abertos).toEqual(["app/e2e/dialog-centralizado.spec.ts"])
  })

  it("mais de um candidato não vira chute: a pessoa lê quais são", async () => {
    busca.entradas = [
      { relPath: "app/src/lib/index.ts", kind: "file" },
      { relPath: "plugin-sdk/index.ts", kind: "file" },
    ]
    await abrirMencaoDeArquivo({ rel: "index.ts", line: null }, PROJETO)
    expect(abertos).toEqual([])
    expect(avisos.info[0]).toContain("2 arquivos se chamam index.ts: app/src/lib/index.ts, plugin-sdk/index.ts")
  })

  it("nenhum candidato diz que não achou, e falha da busca é dita como falha", async () => {
    await abrirMencaoDeArquivo({ rel: "sumiu.ts", line: null }, PROJETO)
    expect(avisos.erro).toEqual(["Não achei sumiu.ts no projeto"])
    busca.falha = true
    const erro = vi.spyOn(console, "error").mockImplementation(() => {})
    await abrirMencaoDeArquivo({ rel: "outro.ts", line: null }, PROJETO)
    expect(avisos.erro[1]).toBe("Não consegui procurar outro.ts no projeto")
    erro.mockRestore()
    expect(abertos).toEqual([])
  })

  it("markdown fora do projeto segue no visualizador de markdown", async () => {
    const abs = "/Users/viniciusmachado/.claude/projects/x/memory/MEMORY.md"
    await abrirMencaoDeArquivo({ rel: "MEMORY.md", abs, line: null }, PROJETO)
    expect(useMarkdownViewer.getState().projectPath).toBe(PROJETO)
    expect(abertos).toEqual([])
  })
})
