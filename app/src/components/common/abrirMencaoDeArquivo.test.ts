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
vi.mock("@/lib/avisos", async () => (await import("@/test/avisosFalsos")).moduloDeAvisosFalsos({ nota: (m: string) => avisos.info.push(m), erro: (m: string) => avisos.erro.push(m), feito: vi.fn(), evento: vi.fn(), fechar: vi.fn() }))

import { useApp } from "@/store/app"
import { emptyConv, useChat } from "@/store/chat"
import { useEscolhaDeArquivo } from "@/store/escolhaDeArquivo"
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
    useEscolhaDeArquivo.getState().fechar()
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

  // 22/09/2026: "4 arquivos se chamam AGENTS.md", e a conversa tinha editado
  // um deles por script no Bash (comando real, início verbatim).
  const QUATRO_AGENTS = [
    { relPath: "AGENTS.md", kind: "file" as const },
    { relPath: "app/src-tauri/companion/AGENTS.md", kind: "file" as const },
    { relPath: "app/src-tauri/src/AGENTS.md", kind: "file" as const },
    { relPath: "app/src/components/chat/AGENTS.md", kind: "file" as const },
  ]
  const comBash = (command: string) =>
    useChat.setState((s) => ({
      byId: {
        ...s.byId,
        c1: { ...emptyConv("p1"), items: [{ kind: "tool", id: "b1", name: "Bash", input: { command } } as never] },
      },
    }))

  it("caminho com pasta num comando de shell da conversa desempata", async () => {
    comBash("python3 - <<'EOF'\np='app/src-tauri/src/AGENTS.md'\ns=open(p).read()")
    busca.entradas = QUATRO_AGENTS
    await abrirMencaoDeArquivo({ rel: "AGENTS.md", line: null }, PROJETO, { x: 10, y: 20 })
    expect(abertos).toEqual(["app/src-tauri/src/AGENTS.md"])
    expect(useEscolhaDeArquivo.getState().pedido).toBeNull()
  })

  it("caminho de shell que o índice não confirma não abre nada sozinho", async () => {
    comBash("cat app/src-tauri/velho/AGENTS.md")
    busca.entradas = QUATRO_AGENTS.slice(0, 2)
    await abrirMencaoDeArquivo({ rel: "AGENTS.md", line: null }, PROJETO, { x: 10, y: 20 })
    expect(abertos).toEqual([])
    expect(useEscolhaDeArquivo.getState().pedido?.candidatos).toEqual([
      "AGENTS.md",
      "app/src-tauri/companion/AGENTS.md",
    ])
  })

  it("sem desempate, a pessoa escolhe no ponto do clique, com os usados primeiro", async () => {
    comBash("sed -n 1,5p app/src/components/chat/AGENTS.md; sed -n 1,5p app/src-tauri/src/AGENTS.md")
    busca.entradas = QUATRO_AGENTS
    await abrirMencaoDeArquivo({ rel: "AGENTS.md", line: null }, PROJETO, { x: 10, y: 20 })
    expect(abertos).toEqual([])
    const pedido = useEscolhaDeArquivo.getState().pedido
    expect(pedido).toMatchObject({ x: 10, y: 20, nome: "AGENTS.md" })
    expect(pedido?.candidatos).toEqual([
      "app/src-tauri/src/AGENTS.md",
      "app/src/components/chat/AGENTS.md",
      "AGENTS.md",
      "app/src-tauri/companion/AGENTS.md",
    ])
    expect(avisos.info).toEqual([])
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

  it("imagem fora do projeto abre na aba de arquivo pelo caminho absoluto", async () => {
    useMarkdownViewer.getState().closeViewer()
    const abs = "/Users/viniciusmachado/.gemini/antigravity-cli/brain/904ca29f-13c5-4602-811d-dd808a237137/screenshot_tiny_pedido_21_full.png"
    await abrirMencaoDeArquivo({ rel: "screenshot_tiny_pedido_21_full.png", abs, line: null }, PROJETO)
    expect(abertos).toEqual([abs])
    expect(useMarkdownViewer.getState().open).toBe(false)
  })

  it("markdown fora do projeto segue no visualizador de markdown", async () => {
    const abs = "/Users/viniciusmachado/.claude/projects/x/memory/MEMORY.md"
    await abrirMencaoDeArquivo({ rel: "MEMORY.md", abs, line: null }, PROJETO)
    expect(useMarkdownViewer.getState().projectPath).toBe(PROJETO)
    expect(abertos).toEqual([])
  })
})
