import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/avisos", async () => (await import("@/test/avisosFalsos")).moduloDeAvisosFalsos())
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(async () => {}) }))
vi.mock("@/lib/db", () => ({ isTauri: vi.fn(() => true) }))

import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { avisar } from "@/lib/avisos"

import { copyRich, copyText } from "./clipboard"
import { isTauri } from "@/lib/db"

beforeEach(() => {
  vi.mocked(avisar.feito).mockClear()
  vi.mocked(avisar.erro).mockClear()
  vi.mocked(writeText).mockClear().mockResolvedValue(undefined)
  vi.mocked(isTauri).mockReturnValue(true)
})
afterEach(() => vi.unstubAllGlobals())

describe("escrita de texto não passa pelo WebView", () => {
  it("copia pelo caminho NATIVO quando está no Tauri", async () => {
    // O ponto da mudança: durante um turno a main thread está renderizando o
    // stream e a escrita do WebView falhava. O caminho nativo não depende dela.
    expect(await copyText("codigo")).toBe(true)
    expect(writeText).toHaveBeenCalledWith("codigo")
    expect(avisar.feito).toHaveBeenCalledWith("Copiado")
  })

  it("não toca no navigator.clipboard quando está no Tauri", async () => {
    const doWebview = vi.fn()
    vi.stubGlobal("navigator", { clipboard: { writeText: doWebview } })
    await copyText("codigo")
    expect(doWebview).not.toHaveBeenCalled()
  })

  it("fora do Tauri usa o navigator, que é o único caminho que existe lá", async () => {
    vi.mocked(isTauri).mockReturnValue(false)
    const doWebview = vi.fn(async () => {})
    vi.stubGlobal("navigator", { clipboard: { writeText: doWebview } })
    expect(await copyText("x")).toBe(true)
    expect(doWebview).toHaveBeenCalledWith("x")
    expect(writeText).not.toHaveBeenCalled()
  })

  it("texto vazio não copia nem avisa", async () => {
    expect(await copyText("   ")).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
    expect(avisar.erro).not.toHaveBeenCalled()
  })

  it("falha do nativo vira toast E log com o motivo", async () => {
    // Engolir o erro foi o que fez este bug durar: a pessoa via "não consegui"
    // e ninguém sabia se era foco, permissão ou API ausente.
    const erro = new DOMException("Document is not focused", "NotAllowedError")
    vi.mocked(writeText).mockRejectedValue(erro)
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await copyText("x")).toBe(false)
    expect(avisar.erro).toHaveBeenCalledWith("Não consegui copiar")
    expect(log.mock.calls[0][0]).toContain("NotAllowedError")
    expect(log.mock.calls[0][0]).toContain("Document is not focused")
    log.mockRestore()
  })
})

describe("tabela: degradação declarada em vez de não copiar", () => {
  it("sem ClipboardItem e sem execCommand, cai no texto nativo e AVISA que foi texto", async () => {
    vi.stubGlobal("ClipboardItem", undefined)
    vi.stubGlobal("navigator", { clipboard: {} })
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      execCommand: () => false,
    })
    expect(await copyRich({ plain: "a\tb", html: "<table/>" })).toBe(true)
    expect(writeText).toHaveBeenCalledWith("a\tb")
    expect(avisar.feito).toHaveBeenCalledWith("Copiado como texto")
  })

  it("quando nem o texto nativo vai, avisa e devolve false", async () => {
    vi.stubGlobal("ClipboardItem", undefined)
    vi.stubGlobal("navigator", { clipboard: {} })
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      execCommand: () => false,
    })
    vi.mocked(writeText).mockRejectedValue(new Error("sem clipboard"))
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await copyRich({ plain: "a", html: "<p/>" })).toBe(false)
    expect(avisar.erro).toHaveBeenCalledWith("Não consegui copiar")
    log.mockRestore()
  })
})
