/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ isTauri: () => true }))

// O medidor do F3 (ADR-291): conta QUANTO markdown passa pelo pipeline a cada
// token. É contador determinístico, como os do F1 (`fio.fluidez.test.ts`), e
// não relógio: a mesma resposta em qualquer máquina.
const medidor = { caracteres: 0, chamadas: 0 }
vi.mock("rehype-highlight", async (importOriginal) => {
  const real = (await importOriginal()) as { default: (o: unknown) => (t: unknown, f: { value: unknown }) => unknown }
  return {
    default: (opcoes: unknown) => {
      const transformar = real.default(opcoes)
      return (arvore: unknown, arquivo: { value: unknown }) => {
        medidor.chamadas++
        medidor.caracteres += String(arquivo.value ?? "").length
        return transformar(arvore, arquivo)
      }
    },
  }
})

import { Markdown } from "@/components/common/Markdown"
import { blocosDaMensagem } from "@/components/common/blocosDaMensagem"
import fioReal from "@/test/fio-real.json"

afterEach(cleanup)
beforeEach(() => {
  medidor.caracteres = 0
  medidor.chamadas = 0
})

const FALAS_REAIS = (fioReal as { kind: string; text?: string }[])
  .filter((item) => item.kind === "text" && item.text)
  .map((item) => item.text as string)
// A maior fala real do fio de referência (10.395 caracteres).
const MAIOR = FALAS_REAIS.reduce((a, b) => (b.length > a.length ? b : a))

/** Desembrulha os spans do fade (sem atributo), para comparar só a forma. */
function formaSemTrechos(el: HTMLElement): string {
  const copia = el.cloneNode(true) as HTMLElement
  for (const span of Array.from(copia.querySelectorAll("span"))) {
    if (span.attributes.length === 0) span.replaceWith(...Array.from(span.childNodes))
  }
  copia.normalize()
  // Inteira, o react-markdown põe um "\n" entre os blocos de topo; dividida,
  // não. Espaço solto entre elementos de bloco não gera linha nem entra no
  // `space-y-2` (que mira elementos): é invisível, e só ele é ignorado.
  const raiz = copia.firstElementChild
  for (const no of Array.from(raiz?.childNodes ?? [])) {
    if (no.nodeType === Node.TEXT_NODE && no.textContent?.trim() === "") no.remove()
  }
  // O Radix gera um id por montagem (`radix-_r_4_`); não é forma.
  return copia.innerHTML.replace(/radix-_r_[0-9a-z]+_/g, "radix-id")
}

describe("F3 · markdown por bloco na bolha viva", () => {
  it("o custo por token deixa de crescer com a mensagem: só o último bloco reparsa", () => {
    const corte = Math.floor(MAIOR.length / 2)
    const { rerender } = render(<Markdown text={MAIOR.slice(0, corte)} vivo />)
    medidor.caracteres = 0
    medidor.chamadas = 0
    const tokens = 50
    let fim = corte
    for (let i = 0; i < tokens; i++) {
      fim += 4
      rerender(<Markdown text={MAIOR.slice(0, fim)} vivo />)
    }
    const maiorBloco = Math.max(...blocosDaMensagem(MAIOR).map((b) => b.texto.length))
    // Uma passada por token, e cada uma do tamanho de UM bloco, não da
    // metade da mensagem (5.197 caracteres) que já estava na tela.
    expect(medidor.chamadas).toBeLessThanOrEqual(tokens + 2)
    expect(medidor.caracteres / tokens).toBeLessThanOrEqual(maiorBloco)
    expect(medidor.caracteres / tokens).toBeLessThan(corte / 5)
  })

  it("assentada, a mensagem é parseada uma vez e não reparsa sem mudar", () => {
    const { rerender } = render(<Markdown text={MAIOR} />)
    expect(medidor.chamadas).toBe(1)
    rerender(<Markdown text={MAIOR} />)
    expect(medidor.chamadas).toBe(1)
  })

  it("zero mudança visual: cada fala real sai com a mesma forma, dividida ou inteira", () => {
    let comparadas = 0
    for (const fala of FALAS_REAIS) {
      if (blocosDaMensagem(fala).length < 2) continue
      const inteira = render(<Markdown text={fala} />)
      const dividida = render(<Markdown text={fala} vivo />)
      expect(formaSemTrechos(dividida.container)).toBe(formaSemTrechos(inteira.container))
      inteira.unmount()
      dividida.unmount()
      comparadas++
    }
    // 39 das 191 falas do fio de referência têm mais de um bloco.
    expect(comparadas).toBe(39)
  })
})
