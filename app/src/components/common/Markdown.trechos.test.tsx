/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ isTauri: () => true }))

import { Markdown } from "@/components/common/Markdown"
import { CLASSE_DO_TRECHO } from "@/components/common/rehypeTrechos"

afterEach(cleanup)

// Resposta REAL de um motor (conversation_items do app), cortada em três
// momentos do streaming, como os deltas chegam.
const REAL =
  "A suíte `native-shell` falhou na verificação completa, mas passou inteira ao repetir sozinha (578 testes). Vou conferir quais testes falharam na primeira rodada antes de seguir."
const MOMENTO_1 = REAL.slice(0, 40)
const MOMENTO_2 = REAL.slice(0, 110)
const MOMENTO_3 = REAL

function trechos(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(`.${CLASSE_DO_TRECHO}`))
}

describe("fade por trecho na resposta viva", () => {
  it("o que já estava na bolha quando ela montou chega pronto", () => {
    const { container } = render(<Markdown text={MOMENTO_1} vivo />)
    expect(trechos(container)).toHaveLength(0)
    expect(container.textContent).toContain("A suíte native-shell")
  })

  it("só o texto que chegou depois dissolve", () => {
    const { container, rerender } = render(<Markdown text={MOMENTO_1} vivo />)
    rerender(<Markdown text={MOMENTO_2} vivo />)
    const novos = trechos(container).map((el) => el.textContent).join("")
    expect(novos.length).toBeGreaterThan(0)
    // Tudo o que dissolve está depois do que já existia.
    expect(MOMENTO_2.slice(MOMENTO_1.length - 8)).toContain(novos.trim().split(" ")[0])
    expect(novos).not.toContain("A suíte")
  })

  it("palavra velha continua sendo o MESMO elemento: o fade não replaya", () => {
    const { container, rerender } = render(<Markdown text={MOMENTO_1} vivo />)
    const primeira = container.querySelector("p > span")
    expect(primeira?.textContent).toBe("A ")
    rerender(<Markdown text={MOMENTO_2} vivo />)
    rerender(<Markdown text={MOMENTO_3} vivo />)
    expect(container.querySelector("p > span")).toBe(primeira)
    expect(primeira?.classList.contains(CLASSE_DO_TRECHO)).toBe(false)
  })

  it("trecho que já dissolveu não recomeça quando chega o seguinte", () => {
    const { container, rerender } = render(<Markdown text={MOMENTO_1} vivo />)
    rerender(<Markdown text={MOMENTO_2} vivo />)
    const jaNovos = trechos(container)
    rerender(<Markdown text={MOMENTO_3} vivo />)
    const depois = trechos(container)
    // Os elementos do momento 2 seguem vivos (mesmos nós), e os do 3 somam.
    for (const el of jaNovos) expect(depois).toContain(el)
    expect(depois.length).toBeGreaterThan(jaNovos.length)
  })

  it("código inline entra inteiro, sem quebrar a menção", () => {
    const { container, rerender } = render(<Markdown text="A suíte" vivo />)
    rerender(<Markdown text={MOMENTO_1} vivo />)
    const code = container.querySelector("code")
    expect(code?.textContent).toBe("native-shell")
    expect(code?.closest(`.${CLASSE_DO_TRECHO}`)).not.toBeNull()
  })

  it("bloco de código não é embrulhado", () => {
    const { container, rerender } = render(<Markdown text="Rodei:" vivo />)
    rerender(<Markdown text={"Rodei:\n\n```sh\nbun run test\n```"} vivo />)
    const pre = container.querySelector("pre")
    expect(pre).not.toBeNull()
    expect(pre?.querySelector(`.${CLASSE_DO_TRECHO}`)).toBeNull()
    expect(pre?.textContent).toContain("bun run test")
  })

  it("assentada, a mensagem volta a ser texto corrido e sem fade", () => {
    const { container, rerender } = render(<Markdown text={MOMENTO_1} vivo />)
    rerender(<Markdown text={MOMENTO_3} vivo />)
    rerender(<Markdown text={MOMENTO_3} />)
    expect(trechos(container)).toHaveLength(0)
    expect(container.querySelector("p > span")).toBeNull()
    expect(container.textContent).toContain("antes de seguir.")
  })

  it("mensagem que nunca foi viva não ganha span nenhum", () => {
    const { container } = render(<Markdown text={MOMENTO_3} />)
    expect(container.querySelector("p > span")).toBeNull()
  })
})
