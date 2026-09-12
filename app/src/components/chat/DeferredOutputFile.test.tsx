import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { DeferredOutputFile } from "./DeferredOutputFile"

const mockIsTauri = vi.fn()

vi.mock("@/lib/db", () => ({
  isTauri: () => mockIsTauri(),
}))

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(async () => {}),
}))

vi.mock("@/lib/clipboard", () => ({
  copyText: vi.fn(async () => true),
}))

describe("<DeferredOutputFile>", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsTauri.mockReturnValue(true)
  })

  it("renderiza rótulo de resultado concluído por padrão e exibe o caminho", () => {
    const html = renderToStaticMarkup(
      createElement(DeferredOutputFile, {
        outputFile: "/tmp/build.log",
        status: "completed",
      }),
    )
    expect(html).toContain("Resultado em disco")
    expect(html).toContain("/tmp/build.log")
  })

  it("renderiza rótulo indicando gravação quando status é running", () => {
    const html = renderToStaticMarkup(
      createElement(DeferredOutputFile, {
        outputFile: "/tmp/build.log",
        status: "running",
      }),
    )
    expect(html).toContain("Saída em disco (em gravação)")
  })

  it("renderiza rótulo indicando interrupção quando status é interrupted", () => {
    const html = renderToStaticMarkup(
      createElement(DeferredOutputFile, {
        outputFile: "/tmp/build.log",
        status: "interrupted",
      }),
    )
    expect(html).toContain("Saída em disco (interrompido)")
  })

  it("renderiza o botão Copiar com título descritivo", () => {
    const html = renderToStaticMarkup(
      createElement(DeferredOutputFile, {
        outputFile: "/tmp/build.log",
      }),
    )
    expect(html).toContain('title="Copiar caminho do arquivo"')
    expect(html).toContain("Copiar")
  })

  it("renderiza Mostrar na pasta quando está no ambiente Tauri", () => {
    mockIsTauri.mockReturnValue(true)
    const html = renderToStaticMarkup(
      createElement(DeferredOutputFile, {
        outputFile: "/tmp/build.log",
      }),
    )
    expect(html).toContain('title="Mostrar na pasta"')
    expect(html).toContain("Mostrar na pasta")
  })

  it("não renderiza Mostrar na pasta quando isTauri é falso (navegador/dev)", () => {
    mockIsTauri.mockReturnValue(false)
    const html = renderToStaticMarkup(
      createElement(DeferredOutputFile, {
        outputFile: "/tmp/build.log",
      }),
    )
    expect(html).not.toContain("Mostrar na pasta")
  })
})
