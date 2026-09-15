import { describe, expect, it } from "vitest"

const sources = import.meta.glob("./ProjectFileViewer.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

const source = Object.values(sources)[0] ?? ""

describe("o leitor principal de arquivos", () => {
  it("mantém renderers próprios para Markdown, código e imagem", () => {
    expect(source).toContain("<Markdown")
    expect(source).toContain("highlightCode(content, language)")
    expect(source).toContain("<img")
  })

  it("valida a imagem e libera o endereço temporário", () => {
    expect(source).toContain("assertSafeRasterImage(bytes, mime)")
    expect(source).toContain("URL.revokeObjectURL(objectUrl)")
  })

  it("arquivo citado fora do projeto é lido pelo caminho absoluto e sem prometer o editor", () => {
    expect(source).toContain('if (path.startsWith("/")) return path')
    expect(source).toContain("{!externo && <OpenInEditor")
  })
})
