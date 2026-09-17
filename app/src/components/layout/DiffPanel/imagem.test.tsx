// A imagem expandida no diff: enquanto lê, esqueleto; sempre com a saída para a
// aba de arquivo; e imagem modificada diz que o que aparece é a versão atual.
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { DiffFile } from "@/lib/git"

vi.mock("@/lib/imagemCitada", () => ({
  imagemCitadaUrl: vi.fn(() => new Promise(() => {})),
}))

import { DiffImagem } from "./imagem"

function arquivo(status: DiffFile["status"]): DiffFile {
  return {
    path: "docs/assets/maestri-chat/video-frame-22.jpg",
    oldPath: null,
    status,
    additions: 0,
    deletions: 0,
    binary: true,
    hunks: [],
    cortado: null,
  }
}

function render(status: DiffFile["status"]) {
  return renderToStaticMarkup(
    createElement(DiffImagem, { cwd: "/repo", file: arquivo(status), galeria: [], versao: 1 }),
  )
}

describe("DiffImagem", () => {
  it("imagem nova mostra o esqueleto e oferece abrir na aba, sem a copy de binário", () => {
    const html = render("added")
    expect(html).toContain("animate-pulse")
    expect(html).toContain("Abrir na aba")
    expect(html).not.toContain("sem diff de texto")
    expect(html).not.toContain("Versão atual")
  })

  it("imagem modificada avisa que só a versão atual aparece", () => {
    expect(render("modified")).toContain("Versão atual. A anterior ainda não aparece aqui.")
  })
})
