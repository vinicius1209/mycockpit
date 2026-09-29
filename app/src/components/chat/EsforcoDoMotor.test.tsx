import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { CLAUDE_EFFORTS } from "@/lib/curatedModels"
import { rotuloDoEsforco } from "@/lib/rotuloDoEsforco"
import { EsforcoDoMotor, leituraDoEsforco } from "./EsforcoDoMotor"

describe("o esforço no seletor de motor (ADR-282)", () => {
  it("os degraus do Claude viram nomes em pt-BR, e o valor do CLI não muda", () => {
    const html = renderToStaticMarkup(
      createElement(EsforcoDoMotor, { efforts: CLAUDE_EFFORTS, valor: "high", travado: false, onChange: () => {} }),
    )
    for (const nome of ["baixo", "médio", "alto", "extra", "máximo"]) expect(html).toContain(`>${nome}<`)
    expect(html).not.toContain(">xhigh<")
    expect(html).toContain("Alto")
    expect(html).toContain("Raciocina mais fundo")
    expect(html).toContain("Padrão")
  })

  it("no padrão, diz que o motor escolhe e não oferece voltar", () => {
    expect(leituraDoEsforco(CLAUDE_EFFORTS, "default")).toEqual({ nome: "Padrão", descricao: "Padrão do modelo" })
    const html = renderToStaticMarkup(
      createElement(EsforcoDoMotor, { efforts: CLAUDE_EFFORTS, valor: "default", travado: false, onChange: () => {} }),
    )
    expect(html).not.toContain("Voltar ao padrão")
  })

  it("degrau desconhecido aparece como o CLI escreveu", () => {
    expect(rotuloDoEsforco("turbo", "turbo")).toBe("turbo")
    expect(rotuloDoEsforco("xhigh", "xhigh")).toBe("extra")
  })
})
