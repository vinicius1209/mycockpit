import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { CartaoDeArquivo, caminhoCurto, pastaJaLiberada, pastasAbsolutas, type ContextoDoCartao } from "./CartaoDeArquivo"

const PROJETO = "/Users/viniciusmachado/projetos/frota"
const ESLINT = "/Users/viniciusmachado/projetos/agencia_vm/vm-prospector/eslint.config.js"
const contexto = (patch: Partial<ContextoDoCartao> = {}): ContextoDoCartao => ({
  projectPath: PROJETO,
  pastasLiberadas: [],
  pastasExtras: true,
  motor: "Claude Code",
  ...patch,
})
const html = (caminho: string, ctx = contexto()) =>
  renderToStaticMarkup(<CartaoDeArquivo caminho={caminho} pasta={false} bytes={305} contexto={ctx} />)

describe("cartão do arquivo solto (ADR-252)", () => {
  it("de fora do projeto: nome, a pasta de onde vem e o aviso", () => {
    const h = html(ESLINT)
    expect(h).toContain("eslint.config.js")
    expect(h).toContain("vm-prospector")
    expect(h).toContain("fora do projeto")
    expect(h).toContain("ring-st-warning")
  })

  it("de dentro do projeto: só a pasta relativa, sem aviso", () => {
    const h = html(`${PROJETO}/app/src/lib/soltura.ts`)
    expect(h).toContain("app/src/lib")
    expect(h).not.toContain("fora do projeto")
    expect(h).not.toContain("ring-st-warning")
  })

  it("motor que não lê fora do projeto: o cartão diz que vai só o caminho", () => {
    expect(html(ESLINT, contexto({ pastasExtras: false }))).toContain("só o caminho")
  })

  it("pasta que o projeto já libera, inclusive por uma pasta acima, não pede para liberar de novo", () => {
    const ctx = contexto({ pastasLiberadas: ["/Users/viniciusmachado/projetos/agencia_vm"] })
    const h = renderToStaticMarkup(
      <CartaoDeArquivo caminho={ESLINT} pasta={false} bytes={305} contexto={ctx} onLiberarSempre={() => {}} />,
    )
    expect(h).toContain("fora do projeto")
    expect(h).not.toContain("só o caminho")
    // Rotina, não alerta: sem borda nem nome em âmbar.
    expect(h).not.toContain("ring-st-warning")
    expect(h).not.toContain("text-st-warning")
  })

  it("motor sem pasta extra não lê nem a pasta liberada no config", () => {
    const ctx = contexto({ pastasExtras: false, pastasLiberadas: ["/Users/viniciusmachado/projetos/agencia_vm"] })
    expect(html(ESLINT, ctx)).toContain("só o caminho")
    expect(html(ESLINT, ctx)).toContain("ring-st-warning")
  })
})

describe("cartão: regras puras", () => {
  it("pasta liberada vale para ela e para o que mora dentro, não para a vizinha", () => {
    expect(pastaJaLiberada("/a/b", ["/a/b/"])).toBe(true)
    expect(pastaJaLiberada("/a/b/c", ["/a/b"])).toBe(true)
    expect(pastaJaLiberada("/a/bc", ["/a/b"])).toBe(false)
  })

  it("extra_dirs relativo é relativo à raiz do projeto", () => {
    expect(pastasAbsolutas(["../outro", "/abs/", "./docs"], PROJETO)).toEqual([
      "/Users/viniciusmachado/projetos/outro",
      "/abs",
      `${PROJETO}/docs`,
    ])
  })

  it("a home vira ~ no caminho do detalhe", () => {
    expect(caminhoCurto("/Users/ana/projetos/x")).toBe("~/projetos/x")
    expect(caminhoCurto("/home/ana/x")).toBe("~/x")
    expect(caminhoCurto("/etc/hosts")).toBe("/etc/hosts")
  })
})
