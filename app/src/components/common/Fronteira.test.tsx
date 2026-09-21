/** @vitest-environment jsdom */
// A janela preta de 21/09/2026: uma exceção num efeito do painel direito
// desmontou a árvore inteira. A fronteira segura o erro na área dele.
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useEffect } from "react"
import { Fronteira } from "./Fronteira"

let quebrado = true
function Painel() {
  if (quebrado) throw new Error("Layout not found for Panel context")
  return <p>painel inteiro</p>
}
/** O caso real: o erro nasceu num EFEITO, não no render. */
function PainelComEfeito() {
  useEffect(() => {
    throw new Error("Layout not found for Panel context")
  }, [])
  return <p>painel com efeito</p>
}

beforeEach(() => {
  quebrado = true
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("Fronteira", () => {
  it("o que quebra fica no seu lugar: o vizinho continua de pé", () => {
    render(
      <div>
        <p>a conversa</p>
        <Fronteira area="o painel lateral">
          <Painel />
        </Fronteira>
      </div>,
    )
    expect(screen.getByText("a conversa")).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toContain("Algo quebrou em o painel lateral.")
    expect(screen.getByRole("alert").textContent).toContain("Layout not found for Panel context")
  })

  it("segura também o erro lançado dentro de um efeito", () => {
    render(
      <div>
        <p>a conversa</p>
        <Fronteira area="o painel lateral">
          <PainelComEfeito />
        </Fronteira>
      </div>,
    )
    expect(screen.getByText("a conversa")).toBeTruthy()
    expect(screen.getByRole("alert")).toBeTruthy()
  })

  it("registra o erro: a tela bonita não esconde o motivo do log", () => {
    render(
      <Fronteira area="o painel lateral">
        <Painel />
      </Fronteira>,
    )
    const chamadas = vi.mocked(console.error).mock.calls.map((c) => String(c[0]))
    expect(chamadas.some((m) => m.includes("[fronteira] o painel lateral quebrou"))).toBe(true)
  })

  it("tentar de novo remonta a área", async () => {
    const user = userEvent.setup()
    render(
      <Fronteira area="o painel lateral">
        <Painel />
      </Fronteira>,
    )
    quebrado = false
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }))
    expect(screen.getByText("painel inteiro")).toBeTruthy()
  })

  it("trocar a chave (outra aba) sai do erro sozinho", () => {
    const { rerender } = render(
      <Fronteira area="esta aba" resetKey="bastidores">
        <Painel />
      </Fronteira>,
    )
    expect(screen.getByRole("alert")).toBeTruthy()
    quebrado = false
    rerender(
      <Fronteira area="esta aba" resetKey="arquivos">
        <Painel />
      </Fronteira>,
    )
    expect(screen.getByText("painel inteiro")).toBeTruthy()
  })

  it("só a da janela oferece recarregar", () => {
    render(
      <Fronteira area="a janela" variante="janela">
        <Painel />
      </Fronteira>,
    )
    expect(screen.getByRole("button", { name: "Recarregar a janela" })).toBeTruthy()
  })
})
