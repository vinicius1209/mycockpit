import { describe, expect, it } from "vitest"
import {
  arquivoSumiu,
  assertSafeRasterImage,
  imageMimeType,
  projectFilePreviewKind,
  urlDoArquivo,
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
    // ADR-240: PDF, vídeo e áudio têm prévia pelo protocolo com leitura em
    // partes; binário sem leitor segue sem prévia (e ganha o cartão com ações).
    expect(projectFilePreviewKind("docs/manual.pdf")).toBe("pdf")
    expect(projectFilePreviewKind("docs/visual-reference/winglee-agent-ui/video.mp4")).toBe("video")
    expect(projectFilePreviewKind("gravacao.MOV")).toBe("video")
    expect(projectFilePreviewKind("assets/aviso.mp3")).toBe("audio")
    expect(projectFilePreviewKind("build/artefatos.zip")).toBe("unsupported")
    expect(projectFilePreviewKind("relatorio.docx")).toBe("unsupported")
  })

  it("monta o endereço do protocolo com raiz e caminho codificados", () => {
    const url = urlDoArquivo("/Users/me/projetos/frota", "docs/pasta com espaço/video.mp4")
    expect(url.startsWith("frota-arquivo://localhost/?")).toBe(true)
    const q = new URL(url).searchParams
    expect(q.get("raiz")).toBe("/Users/me/projetos/frota")
    expect(q.get("caminho")).toBe("docs/pasta com espaço/video.mp4")
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

describe("arquivoSumiu (ADR-243)", () => {
  it("reconhece o ENOENT como o Rust o escreve, e só ele", () => {
    expect(arquivoSumiu("No such file or directory (os error 2)")).toBe(true)
    expect(arquivoSumiu("Permission denied (os error 13)")).toBe(false)
    expect(arquivoSumiu("caminho fora do projeto")).toBe(false)
    expect(arquivoSumiu("(os error 21)")).toBe(false)
  })
})
