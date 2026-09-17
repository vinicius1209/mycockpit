import { describe, expect, it } from "vitest"
import { MAX_ATTACH_COUNT, type Attachment } from "@/lib/attachments"
import { anexosComCaptura, destinoDaMarcacao, linhaDaPagina } from "./capturaDaPagina"

const anexo = (n: number): Attachment => ({
  path: `attachments/c1/${n}.png`,
  name: `${n}.png`,
  kind: "image",
  mime: "image/png",
  bytes: 10,
})

describe("captura da página no rascunho", () => {
  it("entra depois dos anexos que já estavam", () => {
    const captura = anexo(9)
    expect(anexosComCaptura([anexo(1)], captura)).toEqual({ anexos: [anexo(1), captura], coube: true })
  })

  it("a mesma captura (mesmo arquivo) não entra duas vezes", () => {
    expect(anexosComCaptura([anexo(9)], anexo(9))).toEqual({ anexos: [anexo(9)], coube: true })
  })

  it("rascunho no teto de anexos recusa em vez de cortar outro", () => {
    const cheio = Array.from({ length: MAX_ATTACH_COUNT }, (_, i) => anexo(i))
    expect(anexosComCaptura(cheio, anexo(99))).toEqual({ anexos: cheio, coube: false })
  })

  it("a linha diz de onde a imagem veio, com a URL já limpa", () => {
    expect(linhaDaPagina({ title: "Jornal de teste", url: "http://localhost:3981/" })).toBe(
      'Página "Jornal de teste" (http://localhost:3981/):',
    )
    expect(linhaDaPagina({ title: "  ", url: "https://app.exemplo.com/painel" })).toBe(
      "Página https://app.exemplo.com/painel:",
    )
  })
})

describe("destino da marcação (B3)", () => {
  it("motor que lê imagem recebe a imagem junto da descrição", () => {
    expect(destinoDaMarcacao(true, [anexo(1)], anexo(9))).toEqual({ anexos: [anexo(1), anexo(9)], aviso: null })
  })

  it("motor sem imagem recebe só a descrição, e a pessoa é avisada", () => {
    expect(destinoDaMarcacao(false, [anexo(1)], anexo(9))).toEqual({
      anexos: [anexo(1)],
      aviso: "Este motor não lê imagem: vai só a descrição da região.",
    })
  })

  it("rascunho cheio mantém os anexos e avisa", () => {
    const cheio = Array.from({ length: MAX_ATTACH_COUNT }, (_, i) => anexo(i))
    expect(destinoDaMarcacao(true, cheio, anexo(99)).aviso).toContain("vai só a descrição")
  })
})
