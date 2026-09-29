import { describe, expect, it } from "vitest"
import { blocosDaMensagem } from "@/components/common/blocosDaMensagem"
import fioReal from "@/test/fio-real.json"

// As 191 falas REAIS do fio de referência (ADR-016): é a prosa que um motor
// escreve de verdade, com listas, títulos e código inline.
const FALAS_REAIS = (fioReal as { kind: string; text?: string }[])
  .filter((item) => item.kind === "text" && item.text)
  .map((item) => item.text as string)

const textos = (t: string) => blocosDaMensagem(t).map((b) => b.texto)

describe("blocos da mensagem viva", () => {
  it("reconstrói cada fala real sem mudar um caractere", () => {
    expect(FALAS_REAIS.length).toBeGreaterThan(150)
    for (const fala of FALAS_REAIS) {
      const blocos = blocosDaMensagem(fala)
      expect(blocos.map((b) => b.texto).join("")).toBe(fala)
      for (const b of blocos) expect(fala.slice(b.inicio, b.inicio + b.texto.length)).toBe(b.texto)
    }
  })

  it("fala real longa vira vários blocos (senão o memo não teria o que cortar)", () => {
    const maior = FALAS_REAIS.reduce((a, b) => (b.length > a.length ? b : a))
    expect(blocosDaMensagem(maior).length).toBeGreaterThan(5)
  })

  it("corta entre parágrafos", () => {
    expect(textos("Um.\n\nDois.\n\nTrês.")).toEqual(["Um.\n\n", "Dois.\n\n", "Três."])
  })

  it("não corta dentro de cerca, mesmo com linha em branco no código", () => {
    const t = "Rodei:\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\nFim."
    expect(textos(t)).toEqual(["Rodei:\n\n", "```ts\nconst a = 1\n\nconst b = 2\n```\n\n", "Fim."])
  })

  it("cerca ainda aberta (resposta chegando) segura o resto no mesmo bloco", () => {
    const t = "Veja:\n\n```sh\nbun run test\n\nbun run check"
    expect(textos(t)).toEqual(["Veja:\n\n", "```sh\nbun run test\n\nbun run check"])
  })

  it("não separa itens da mesma lista, nem lista frouxa", () => {
    expect(textos("- a\n\n- b\n\n- c")).toHaveLength(1)
    expect(textos("1. a\n\n2. b")).toHaveLength(1)
  })

  it("continuação recuada de item fica no item", () => {
    expect(textos("- a\n\n  mais do item a\n\n- b")).toHaveLength(1)
  })

  it("parágrafo depois da lista é outro bloco; lista depois do parágrafo também", () => {
    expect(textos("- a\n- b\n\nDepois.")).toEqual(["- a\n- b\n\n", "Depois."])
    expect(textos("Antes.\n\n- a")).toEqual(["Antes.\n\n", "- a"])
  })

  it("definição de link, nota de rodapé ou HTML em bloco deixam a mensagem inteira", () => {
    expect(textos("Veja [o guia][g].\n\n[g]: https://x.dev")).toHaveLength(1)
    expect(textos("Isto[^1].\n\n[^1]: nota")).toHaveLength(1)
    expect(textos("<details>\n\nconteúdo\n\n</details>")).toHaveLength(1)
  })

  it("vazio e texto de uma linha são um bloco só", () => {
    expect(textos("")).toEqual([""])
    expect(textos("oi")).toEqual(["oi"])
  })

  it("a identidade do bloco (o início) não muda quando o texto cresce", () => {
    const antes = blocosDaMensagem("Um.\n\nDois")
    const depois = blocosDaMensagem("Um.\n\nDois e três.\n\nQuatro")
    expect(depois.slice(0, antes.length).map((b) => b.inicio)).toEqual(antes.map((b) => b.inicio))
    expect(depois[0].texto).toBe(antes[0].texto)
  })
})
