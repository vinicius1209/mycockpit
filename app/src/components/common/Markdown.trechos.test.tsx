/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ isTauri: () => true }))

import { Markdown } from "@/components/common/Markdown"
import {
  CLASSE_DO_TRECHO,
  DURACAO_DO_TRECHO_MS,
  inicioDosJovens,
  registrarTrechos,
} from "@/components/common/rehypeTrechos"

// Relógio parado: o que é "recém-chegado" não pode depender da velocidade da
// máquina que roda o teste. Quem precisa do tempo passando o avança.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(1_790_000_000_000)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

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

  it("espaço entre linhas de tabela e itens de lista não vira span (HTML inválido)", () => {
    const { container, rerender } = render(<Markdown text="Resultado:" vivo />)
    rerender(<Markdown text={"Resultado:\n\n| Ação | Resultado |\n|---|---|\n| teste | passou |\n\n- um\n- dois"} vivo />)
    const invalidos = container.querySelectorAll(
      "table > span, thead > span, tbody > span, tr > span, ul > span, ol > span",
    )
    expect(invalidos).toHaveLength(0)
    expect(container.querySelector("td")?.textContent).toBe("teste")
  })

  it("mensagem que nunca foi viva não ganha span nenhum", () => {
    const { container } = render(<Markdown text={MOMENTO_3} />)
    expect(container.querySelector("p > span")).toBeNull()
  })

  it("palavra que você já está lendo não pisca quando o markdown muda de forma", () => {
    // "Lista:" seguido de "-" sozinho é um título (setext) por um instante; o
    // item completa e ele volta a parágrafo. O elemento é recriado, mas a
    // palavra chegou há mais que a duração do fade: não anima de novo.
    const { container, rerender } = render(<Markdown text="Intro." vivo />)
    rerender(<Markdown text={"Intro.\nLista:"} vivo />)
    vi.advanceTimersByTime(DURACAO_DO_TRECHO_MS + 80)
    rerender(<Markdown text={"Intro.\nLista:\n-"} vivo />)
    expect(container.querySelector("h2, h3")).not.toBeNull()
    rerender(<Markdown text={"Intro.\nLista:\n- um item"} vivo />)
    const piscando = trechos(container).map((el) => el.textContent ?? "")
    expect(piscando.join("")).not.toContain("Lista")
    expect(piscando.join("")).toContain("item")
  })
})

describe("o que ainda está dissolvendo", () => {
  const T = 1_790_000_000_000

  it("o texto da montagem chega pronto", () => {
    const r = { tamanho: 40, jovens: [] }
    expect(inicioDosJovens(r)).toBe(40)
  })

  it("o que chega agora dissolve a partir de onde o texto estava", () => {
    const r = registrarTrechos({ tamanho: 40, jovens: [] }, 55, T)
    expect(inicioDosJovens(r)).toBe(40)
  })

  it("passada a duração do fade, o trecho sai da faixa e não anima mais", () => {
    let r = registrarTrechos({ tamanho: 40, jovens: [] }, 55, T)
    r = registrarTrechos(r, 70, T + 200)
    expect(inicioDosJovens(r)).toBe(40)
    r = registrarTrechos(r, 70, T + DURACAO_DO_TRECHO_MS)
    expect(inicioDosJovens(r)).toBe(55)
    r = registrarTrechos(r, 70, T + 200 + DURACAO_DO_TRECHO_MS)
    expect(inicioDosJovens(r)).toBe(70)
  })

  it("texto que encolheu (resposta reescrita) não deixa trecho fantasma", () => {
    let r = registrarTrechos({ tamanho: 40, jovens: [] }, 80, T)
    r = registrarTrechos(r, 30, T + 10)
    expect(inicioDosJovens(r)).toBe(30)
  })
})
