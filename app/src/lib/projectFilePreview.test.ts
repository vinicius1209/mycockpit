import { describe, expect, it } from "vitest"
import {
  assertSafeRasterImage,
  imageMimeType,
  projectFilePreviewKind,
  rasterDimensions,
} from "./projectFilePreview"

// Cabeçalho de um PNG real de 1 × 1 px. O restante do payload não é necessário
// porque a guarda só inspeciona assinatura e IHDR antes de acionar o decoder.
const REAL_PNG_HEADER = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
])

describe("projectFilePreviewKind", () => {
  it("separa Markdown, imagens, código e binários não exibidos", () => {
    expect(projectFilePreviewKind("README.md")).toBe("markdown")
    expect(projectFilePreviewKind("docs/foto.JPEG")).toBe("image")
    expect(projectFilePreviewKind("src/app.tsx")).toBe("code")
    expect(projectFilePreviewKind("docs/manual.pdf")).toBe("unsupported")
  })

  it("resolve o MIME de fotos suportadas", () => {
    expect(imageMimeType("evidencias/tela.png")).toBe("image/png")
    expect(imageMimeType("evidencias/foto.jpg")).toBe("image/jpeg")
    expect(imageMimeType("README.md")).toBeNull()
  })
})

describe("rasterDimensions", () => {
  it("lê dimensões do cabeçalho PNG antes da decodificação", () => {
    expect(rasterDimensions(REAL_PNG_HEADER, "image/png")).toEqual({
      width: 1,
      height: 1,
    })
    expect(assertSafeRasterImage(REAL_PNG_HEADER, "image/png")).toEqual({
      width: 1,
      height: 1,
    })
  })

  it("rejeita cabeçalho inválido e imagem com pixels demais", () => {
    expect(() => assertSafeRasterImage(new Uint8Array([1, 2]), "image/png")).toThrow(
      "validar as dimensões",
    )
    const huge = REAL_PNG_HEADER.slice()
    huge.set([0x00, 0x00, 0x27, 0x10], 16)
    huge.set([0x00, 0x00, 0x27, 0x10], 20)
    expect(() => assertSafeRasterImage(huge, "image/png")).toThrow(
      "grande demais",
    )
  })
})
