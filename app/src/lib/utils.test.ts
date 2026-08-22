// A rede do `formatDisplayPath`.
//
// Ela nasceu depois da função, no review — e por isso os três primeiros testes
// são casos que a primeira versão errava. Ficam aqui nomeados pelo defeito, não
// pela feature: é o que impede a regra de voltar ao contrário na próxima
// passada.

import { describe, expect, it } from "vitest"
import { formatDisplayPath, shortPath } from "./utils"

describe("shortPath", () => {
  it("troca o $HOME por ~", () => {
    expect(shortPath("/Users/vini/projetos/x")).toBe("~/projetos/x")
  })

  it("não mexe em caminho de fora do $HOME", () => {
    expect(shortPath("/opt/homebrew/bin")).toBe("/opt/homebrew/bin")
  })
})

describe("formatDisplayPath", () => {
  it("caminho curto passa intacto", () => {
    expect(formatDisplayPath("/Users/vini/projetos/mycockpit")).toBe(
      "~/projetos/mycockpit",
    )
  })

  it("NÃO colapsa caminhos diferentes na mesma string", () => {
    // O defeito da primeira versão: guardava só o último segmento, e estes dois
    // viravam `~/…/web`. Numa lista de "diretórios liberados", dois diretórios
    // distintos lidos igual é pior que um caminho comprido.
    const a = formatDisplayPath("/Users/vini/projetos/clientes/acme/apps/web")
    const b = formatDisplayPath("/Users/vini/projetos/pessoal/blog/apps/web")
    expect(a).not.toBe(b)
    expect(a).toContain("acme")
    expect(b).toContain("blog")
  })

  it("ENCURTA o caminho longo (a versão anterior desistia justo nele)", () => {
    const longo =
      "/Users/vini/projetos/a/b/c/d/e/f/nome-de-diretorio-absurdamente-longo"
    const out = formatDisplayPath(longo)
    expect(out.length).toBeLessThan(shortPath(longo).length)
    expect(out).toContain("…")
  })

  it("caminho relativo NÃO ganha uma barra inventada na frente", () => {
    // `/projetos/…` a partir de `projetos/…` seria afirmar um caminho absoluto
    // que não existe.
    const out = formatDisplayPath(
      "projetos/clientes/acme/frontend/apps/web-com-nome-longo",
    )
    expect(out.startsWith("/")).toBe(false)
    expect(out.startsWith("projetos/")).toBe(true)
  })

  it("preserva a raiz e sempre o último segmento", () => {
    const out = formatDisplayPath(
      "/Users/vini/projetos/clientes/acme/frontend/apps/web",
    )
    expect(out.startsWith("~/")).toBe(true)
    expect(out.endsWith("/web")).toBe(true)
  })

  it("cresce a cauda até o limite, e não além", () => {
    const out = formatDisplayPath(
      "/Users/vini/projetos/clientes/acme/frontend/apps/web",
      34,
    )
    expect(out.length).toBeLessThanOrEqual(34)
  })

  it("caminho raso demais pra elidir volta inteiro", () => {
    // Dois segmentos não têm meio: elidir aqui trocaria informação por "…".
    expect(formatDisplayPath("/Users/vini/nome-de-pasta-bem-comprido-aqui")).toBe(
      "~/nome-de-pasta-bem-comprido-aqui",
    )
  })

  it("é estável: rodar de novo no resultado não degrada mais", () => {
    const uma = formatDisplayPath("/Users/vini/projetos/clientes/acme/apps/web")
    expect(formatDisplayPath(uma)).toBe(uma)
  })
})
