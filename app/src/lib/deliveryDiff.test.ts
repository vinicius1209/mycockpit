// P3 — Entrega → diff em 1 clique (lib/deliveryDiff): o gesto navega até a
// conversa, valida worktree/diff com honestidade (toast quando não há mudança)
// e emite a intenção deliveryDiff que o ContextPanel consome. fixPrefill monta
// o prefill do "Pedir correção".

import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  tauri: true,
  loadGitDiff: vi.fn(),
  toast: vi.fn(),
}))

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  isTauri: () => h.tauri,
}))

vi.mock("@/lib/git", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/git")>()),
  loadGitDiff: h.loadGitDiff,
}))

vi.mock("@/lib/avisos", async () => (await import("@/test/avisosFalsos")).moduloDeAvisosFalsos({ nota: h.toast, feito: vi.fn(), evento: vi.fn(), erro: vi.fn(), fechar: vi.fn() }))

import {
  FIX_PREFILL_MAX,
  NO_DIFF_MESSAGE,
  composeDiffComments,
  diffLineKey,
  fixPrefill,
  openDeliveryDiff,
  staleComments,
  type DiffComment,
} from "./deliveryDiff"
import { useApp } from "@/store/app"
import { useChat, type ConvState } from "@/store/chat"

const CONV = "c1"

function conv(over: Partial<ConvState> = {}): ConvState {
  return {
    projectId: "p1",
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [],
    sessionId: null,
    model: null,
    streamingTextId: null,
    running: false,
    finalizing: false,
    runId: null,
    startedAt: null,
    suggestions: [],
    suggesting: false,
    ...over,
  }
}

function fileDiff(files: number) {
  return {
    isRepo: true,
    branch: "main",
    files: Array.from({ length: files }, (_, i) => ({
      path: `f${i}.ts`,
      oldPath: null,
      status: "modified" as const,
      additions: 1,
      deletions: 0,
      binary: false,
      hunks: [],
    })),
  }
}

beforeEach(() => {
  h.tauri = true
  h.loadGitDiff.mockReset()
  h.toast.mockClear()
  useApp.setState({
    deliveryDiff: null,
    contextOpen: true,
    viewMode: "painel",
    activeProjectId: null,
  })
  useChat.setState({ byId: {}, activeId: null })
})

describe("openDeliveryDiff — gate honesto", () => {
  it("conversa sem worktree ⇒ toast honesto e NENHUMA intenção", async () => {
    useChat.setState({ byId: { [CONV]: conv() } })
    const ok = await openDeliveryDiff({ convId: CONV, text: "entrega" })
    expect(ok).toBe(false)
    expect(h.toast).toHaveBeenCalledWith(NO_DIFF_MESSAGE)
    expect(useApp.getState().deliveryDiff).toBeNull()
    expect(h.loadGitDiff).not.toHaveBeenCalled()
  })

  it("worktree com working tree limpa ⇒ toast honesto, sem intenção", async () => {
    useChat.setState({ byId: { [CONV]: conv({ worktreePath: "/wt" }) } })
    h.loadGitDiff.mockResolvedValue(fileDiff(0))
    const ok = await openDeliveryDiff({ convId: CONV, text: "entrega" })
    expect(ok).toBe(false)
    expect(h.loadGitDiff).toHaveBeenCalledWith("/wt")
    expect(h.toast).toHaveBeenCalledWith(NO_DIFF_MESSAGE)
    expect(useApp.getState().deliveryDiff).toBeNull()
  })

  it("worktree que nem é repo ⇒ toast honesto (não finge diff)", async () => {
    useChat.setState({ byId: { [CONV]: conv({ worktreePath: "/wt" }) } })
    h.loadGitDiff.mockResolvedValue({ isRepo: false, branch: null, files: [] })
    expect(await openDeliveryDiff({ convId: CONV, text: "x" })).toBe(false)
    expect(h.toast).toHaveBeenCalledWith(NO_DIFF_MESSAGE)
  })
})

describe("openDeliveryDiff — caminho feliz", () => {
  it("diff com arquivos ⇒ emite a intenção e força o painel aberto", async () => {
    useApp.setState({ contextOpen: false })
    useChat.setState({ byId: { [CONV]: conv({ worktreePath: "/wt" }) } })
    h.loadGitDiff.mockResolvedValue(fileDiff(2))
    const ok = await openDeliveryDiff({ convId: CONV, text: "parser pronto" })
    expect(ok).toBe(true)
    expect(h.toast).not.toHaveBeenCalled()
    expect(useApp.getState().deliveryDiff).toEqual({
      convId: CONV,
      text: "parser pronto",
    })
    expect(useApp.getState().contextOpen).toBe(true)
  })

  it("com projectId (Central) ⇒ navega projeto→conversa→Trabalho antes", async () => {
    const openProject = vi.fn(async () => {})
    const switchConversation = vi.fn(async () => {})
    useChat.setState({
      byId: { [CONV]: conv({ worktreePath: "/wt" }) },
      openProject,
      switchConversation,
    })
    h.loadGitDiff.mockResolvedValue(fileDiff(1))
    const ok = await openDeliveryDiff({
      convId: CONV,
      text: "entrega",
      projectId: "p1",
    })
    expect(ok).toBe(true)
    expect(useApp.getState().activeProjectId).toBe("p1")
    expect(openProject).toHaveBeenCalledWith("p1")
    expect(switchConversation).toHaveBeenCalledWith(CONV)
    expect(useApp.getState().viewMode).toBe("linear")
    expect(useApp.getState().deliveryDiff).toEqual({ convId: CONV, text: "entrega" })
  })

  it("sem projectId (clique no fio) NÃO troca projeto/superfície", async () => {
    useChat.setState({ byId: { [CONV]: conv({ worktreePath: "/wt" }) } })
    h.loadGitDiff.mockResolvedValue(fileDiff(1))
    useApp.setState({ viewMode: "linear", activeProjectId: "p9" })
    await openDeliveryDiff({ convId: CONV, text: "x" })
    expect(useApp.getState().activeProjectId).toBe("p9")
    expect(useApp.getState().viewMode).toBe("linear")
  })
})

describe("openDeliveryDiff — browser/sim (fora do Tauri)", () => {
  it("pula o gate de git (não há o que consultar) e emite a intenção", async () => {
    h.tauri = false
    const ok = await openDeliveryDiff({ convId: CONV, text: "sim" })
    expect(ok).toBe(true)
    expect(h.loadGitDiff).not.toHaveBeenCalled()
    expect(useApp.getState().deliveryDiff).toEqual({ convId: CONV, text: "sim" })
  })
})

describe("fixPrefill — prefill do Pedir correção", () => {
  it("cita a 1ª linha da entrega e termina em 'Corrija: '", () => {
    expect(fixPrefill("Parser pronto\ncom testes")).toBe(
      "Sobre a entrega: Parser pronto\nCorrija: ",
    )
  })

  it("trunca entregas longas com reticências (sem estourar o composer)", () => {
    const long = "x".repeat(FIX_PREFILL_MAX + 50)
    const out = fixPrefill(long)
    const excerpt = out.slice("Sobre a entrega: ".length, out.indexOf("\n"))
    expect(excerpt.length).toBe(FIX_PREFILL_MAX)
    expect(excerpt.endsWith("…")).toBe(true)
  })

  it("entrega vazia não quebra o formato", () => {
    expect(fixPrefill("")).toBe("Sobre a entrega: \nCorrija: ")
  })
})

describe("composeDiffComments — prefill dos comentários soltos no diff", () => {
  const comment = (over: Partial<DiffComment> = {}): DiffComment => ({
    id: "1",
    path: "app/src/foo.ts",
    side: "new",
    lineNo: 42,
    codeText: "const x = 1",
    note: "isso aqui tá errado",
    ...over,
  })

  it("sem comentários, não compõe nada", () => {
    expect(composeDiffComments([])).toBe("")
  })

  it("um comentário: local (path:linha), trecho citado e a nota", () => {
    const out = composeDiffComments([comment()])
    expect(out).toContain("Comentários no diff:")
    expect(out).toContain("app/src/foo.ts:42")
    expect(out).toContain("const x = 1")
    expect(out).toContain("→ isso aqui tá errado")
  })

  it("linha deletada (sem newNo): cita só o path, sem ':null'", () => {
    const out = composeDiffComments([comment({ lineNo: null })])
    expect(out).toContain("app/src/foo.ts\n")
    expect(out).not.toContain("null")
  })

  it("vários comentários mantêm a ordem e ficam em blocos separados", () => {
    const out = composeDiffComments([
      comment({ id: "1", path: "a.ts", lineNo: 1, note: "primeiro" }),
      comment({ id: "2", path: "b.ts", lineNo: 2, note: "segundo" }),
    ])
    expect(out.indexOf("a.ts:1")).toBeLessThan(out.indexOf("b.ts:2"))
    expect(out.indexOf("primeiro")).toBeLessThan(out.indexOf("segundo"))
  })
})

describe("staleComments — comentário que perdeu a linha", () => {
  const linha = (over: Partial<{ type: "add" | "del" | "ctx"; oldNo: number | null; newNo: number | null; text: string }> = {}) => ({
    type: "add" as const,
    oldNo: null,
    newNo: 42,
    text: "const x = 1",
    ...over,
  })
  const arquivo = (lines: ReturnType<typeof linha>[]) => [
    { path: "a.ts", hunks: [{ lines }] },
  ]
  const c = (over: Partial<DiffComment> = {}): DiffComment => ({
    id: diffLineKey("a.ts", "new", 42),
    path: "a.ts",
    side: "new",
    lineNo: 42,
    codeText: "const x = 1",
    note: "arruma isso",
    ...over,
  })

  it("linha intacta: nada é órfão", () => {
    expect(staleComments([c()], arquivo([linha()]))).toEqual([])
  })

  it("MESMO número, texto mudou: vira órfão (era o bug do badge na linha errada)", () => {
    const files = arquivo([linha({ text: "const x = 999" })])
    expect(staleComments([c()], files).map((x) => x.id)).toEqual([c().id])
  })

  it("linha sumiu do diff: vira órfão", () => {
    expect(staleComments([c()], arquivo([]))).toHaveLength(1)
  })

  it("arquivo inteiro sumiu do diff: vira órfão", () => {
    expect(staleComments([c()], [])).toHaveLength(1)
  })

  it("mesma linha noutro ARQUIVO não salva o comentário", () => {
    const files = [{ path: "outro.ts", hunks: [{ lines: [linha()] }] }]
    expect(staleComments([c()], files)).toHaveLength(1)
  })

  it("hunk re-recortado (mesma linha, outra posição) NÃO vira órfão", () => {
    // duas linhas de contexto antes: em chave posicional o índice mudaria.
    const files = [
      {
        path: "a.ts",
        hunks: [
          {
            lines: [
              linha({ type: "ctx", oldNo: 40, newNo: 40, text: "ctx a" }),
              linha({ type: "ctx", oldNo: 41, newNo: 41, text: "ctx b" }),
              linha(),
            ],
          },
        ],
      },
    ]
    expect(staleComments([c()], files)).toEqual([])
  })

  it("comentário em linha DELETADA casa pelo lado antigo", () => {
    const del = linha({ type: "del", oldNo: 7, newNo: null, text: "sumiu" })
    const comentario = c({
      id: diffLineKey("a.ts", "old", 7),
      side: "old",
      lineNo: 7,
      codeText: "sumiu",
    })
    expect(staleComments([comentario], arquivo([del]))).toEqual([])
  })
})

describe("composeDiffComments — marcação de órfão", () => {
  const c: DiffComment = {
    id: "a.ts@new:42",
    path: "a.ts",
    side: "new",
    lineNo: 42,
    codeText: "const x = 1",
    note: "arruma",
  }

  it("comentário vivo não ganha aviso", () => {
    expect(composeDiffComments([c])).not.toContain("mudou depois")
  })

  it("órfão avisa que a linha mudou, mas mantém a citação", () => {
    const out = composeDiffComments([c], new Set([c.id]))
    expect(out).toContain("a linha mudou depois do comentário")
    expect(out).toContain("const x = 1")
    expect(out).toContain("→ arruma")
  })
})
