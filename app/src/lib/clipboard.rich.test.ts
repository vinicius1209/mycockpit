import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from "sonner"
import { copyRich } from "./clipboard"

class FakeClipboardItem {
  itens: Record<string, Blob>
  constructor(itens: Record<string, Blob>) {
    this.itens = itens
  }
}

beforeEach(() => {
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
})
afterEach(() => vi.unstubAllGlobals())

describe("copiar texto e HTML juntos", () => {
  it("usa ClipboardItem com os dois formatos quando existe", async () => {
    const write = vi.fn(async (_: FakeClipboardItem[]) => {})
    vi.stubGlobal("ClipboardItem", FakeClipboardItem)
    vi.stubGlobal("navigator", { clipboard: { write, writeText: vi.fn() } })
    expect(await copyRich({ plain: "a\tb", html: "<table></table>" }, "Tabela copiada")).toBe(true)
    const [item] = write.mock.calls[0][0]
    expect(Object.keys(item.itens).sort()).toEqual(["text/html", "text/plain"])
    expect(await item.itens["text/html"].text()).toBe("<table></table>")
    expect(toast.success).toHaveBeenCalledWith("Tabela copiada")
  })

  it("sem escrita assíncrona, cai no evento copy com os dois formatos", async () => {
    const dados: Record<string, string> = {}
    let ouvinte: ((e: unknown) => void) | null = null
    vi.stubGlobal("ClipboardItem", undefined)
    vi.stubGlobal("navigator", { clipboard: {} })
    vi.stubGlobal("document", {
      addEventListener: (_: string, fn: (e: unknown) => void) => (ouvinte = fn),
      removeEventListener: () => (ouvinte = null),
      execCommand: () => {
        ouvinte?.({ preventDefault() {}, clipboardData: { setData: (t: string, v: string) => (dados[t] = v) } })
        return true
      },
    })
    expect(await copyRich({ plain: "a\tb", html: "<table/>" })).toBe(true)
    expect(dados).toEqual({ "text/plain": "a\tb", "text/html": "<table/>" })
  })

  it("nenhum caminho funcionou: avisa e devolve false", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem)
    vi.stubGlobal("navigator", { clipboard: { write: vi.fn(async () => { throw new Error("negado") }) } })
    vi.stubGlobal("document", { addEventListener() {}, removeEventListener() {}, execCommand: () => false })
    expect(await copyRich({ plain: "x", html: "<b>x</b>" })).toBe(false)
    expect(toast.error).toHaveBeenCalledWith("Não consegui copiar")
  })

  it("conteúdo vazio não copia nem avisa", async () => {
    expect(await copyRich({ plain: "  " })).toBe(false)
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })
})
