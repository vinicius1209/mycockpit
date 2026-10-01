/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { GatilhoDaFaixa, PainelDaFaixa } from "./statusBarChrome"

afterEach(cleanup)

const esperar = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))

function Zona() {
  const [aberto, setAberto] = useState(false)
  return (
    <PainelDaFaixa
      open={aberto}
      onOpenChange={setAberto}
      titulo="Janela de uso"
      icone={null}
      conteudo={<p>todas as janelas aqui</p>}
      dica={<p>resumo da dica</p>}
    >
      <GatilhoDaFaixa>12%</GatilhoDaFaixa>
    </PainelDaFaixa>
  )
}

describe("a dica da faixa e o painel do clique", () => {
  it("fechar o painel não traz a dica de volta", async () => {
    const user = userEvent.setup()
    render(<Zona />)
    const gatilho = screen.getByRole("button", { name: "12%" })

    await user.hover(gatilho)
    await esperar(450)
    expect(screen.queryByText("resumo da dica")).not.toBeNull()

    await user.click(gatilho)
    expect(screen.queryByText("todas as janelas aqui")).not.toBeNull()
    await esperar(150)
    expect(screen.queryByText("resumo da dica")).toBeNull()

    await user.keyboard("{Escape}")
    await esperar(450)
    expect(screen.queryByText("todas as janelas aqui")).toBeNull()
    expect(screen.queryByText("resumo da dica")).toBeNull()
  })

  it("depois de fechar, um hover novo na zona volta a mostrar a dica", async () => {
    const user = userEvent.setup()
    render(<Zona />)
    const gatilho = screen.getByRole("button", { name: "12%" })

    await user.click(gatilho)
    await user.keyboard("{Escape}")
    await esperar(450)
    expect(screen.queryByText("resumo da dica")).toBeNull()

    await user.unhover(gatilho)
    await user.hover(gatilho)
    await esperar(450)
    expect(screen.queryByText("resumo da dica")).not.toBeNull()
  })
})
