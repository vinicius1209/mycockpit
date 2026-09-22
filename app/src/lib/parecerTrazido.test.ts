import { describe, expect, it } from "vitest"
import {
  alternarParecer,
  blocoDosPareceres,
  parecerJaTrazido,
  rotuloDaCarga,
  rotuloDoParecer,
  type BlocoParecer,
} from "./parecerTrazido"

const parecer = (over: Partial<BlocoParecer> = {}): BlocoParecer => ({
  tipo: "parecer",
  id: "b1",
  itemId: "adv-1",
  personaId: "projeto:iris",
  personaNome: "Íris",
  texto: "Some com a duplicação do topo.",
  ...over,
})

describe("parecer trazido para o executor", () => {
  it("a pílula diz de quem é, e o rodapé conta quantos vão", () => {
    expect(rotuloDoParecer(parecer())).toBe("Parecer de Íris")
    expect(rotuloDaCarga(0)).toBeNull()
    expect(rotuloDaCarga(1)).toBe("leva 1 parecer")
    expect(rotuloDaCarga(2)).toBe("leva 2 pareceres")
  })

  it("o mesmo gesto traz e tira: clicar duas vezes não leva o parecer em dobro", () => {
    const uma = alternarParecer([], parecer())
    expect(uma).toHaveLength(1)
    expect(parecerJaTrazido(uma, "adv-1")).toBe(true)
    const nenhuma = alternarParecer(uma, parecer())
    expect(nenhuma).toHaveLength(0)
    expect(parecerJaTrazido(nenhuma, "adv-1")).toBe(false)
  })

  it("dois pareceres convivem, e tirar um não tira o outro", () => {
    const dois = alternarParecer(
      alternarParecer([], parecer()),
      parecer({ id: "b2", itemId: "adv-2", personaNome: "Aline" }),
    )
    expect(dois).toHaveLength(2)
    const so = alternarParecer(dois, parecer())
    expect(so.map((b) => (b as BlocoParecer).personaNome)).toEqual(["Aline"])
  })

  it("convive com os outros blocos do rascunho sem mexer neles", () => {
    const citacao = { tipo: "citacao" }
    const com = alternarParecer([citacao], parecer())
    expect(com[0]).toBe(citacao)
    expect(alternarParecer(com, parecer())).toEqual([citacao])
  })

  it("no prompt vira bloco de conselheiro, na ordem em que foi trazido", () => {
    const dois = [parecer(), parecer({ id: "b2", itemId: "adv-2", personaNome: "Aline", texto: "Promessa falsa é o problema." })]
    const texto = blocoDosPareceres(dois)!
    expect(texto.indexOf('de="Íris"')).toBeLessThan(texto.indexOf('de="Aline"'))
    expect(texto).toContain("só leitura")
    expect(texto).toContain("Some com a duplicação do topo.")
  })

  it("sem parecer trazido o turno não leva bloco nenhum", () => {
    expect(blocoDosPareceres([])).toBeNull()
    expect(blocoDosPareceres([{ tipo: "colagem" }])).toBeNull()
    expect(blocoDosPareceres(undefined)).toBeNull()
  })
})
