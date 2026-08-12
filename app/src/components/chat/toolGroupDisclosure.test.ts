// Regra de disclosure dos grupos (despoluição do fio, direção B): o passado
// custa UMA linha; só o vivo fica aberto; a falha não se esconde; e o
// recolhimento automático nunca puxa o tapete de quem está lendo.
import { describe, expect, it } from "vitest"
import {
  bornOpen,
  settledOkStubLabel,
  shouldAutoCollapseOnSettle,
} from "./toolGroupDisclosure"

describe("bornOpen · o que nasce aberto no fio", () => {
  it("concluído nasce recolhido (o passado custa uma linha)", () => {
    expect(bornOpen({ live: false, failed: false })).toBe(false)
  })

  it("vivo nasce aberto (o presente é o único que ocupa altura)", () => {
    expect(bornOpen({ live: true, failed: false })).toBe(true)
  })

  it("falha assentada nasce aberta (a falha não recolhe quieta)", () => {
    expect(bornOpen({ live: false, failed: true })).toBe(true)
  })
})

describe("shouldAutoCollapseOnSettle · vivo → assentado", () => {
  const base = {
    manuallyToggled: false,
    failed: false,
    groupInViewport: false,
    followingBottom: true,
  }

  it("fora da viewport recolhe: ninguém estava lendo o grupo", () => {
    expect(shouldAutoCollapseOnSettle({ ...base, groupInViewport: false })).toBe(
      true,
    )
  })

  it("leitor seguindo o fundo do fio recolhe (stick-to-bottom preserva a posição)", () => {
    expect(
      shouldAutoCollapseOnSettle({
        ...base,
        groupInViewport: true,
        followingBottom: true,
      }),
    ).toBe(true)
  })

  it("leitor desancorado com o grupo visível NÃO recolhe (não puxa o tapete)", () => {
    expect(
      shouldAutoCollapseOnSettle({
        ...base,
        groupInViewport: true,
        followingBottom: false,
      }),
    ).toBe(false)
  })

  it("toggle manual do usuário vence qualquer regra automática", () => {
    expect(
      shouldAutoCollapseOnSettle({ ...base, manuallyToggled: true }),
    ).toBe(false)
  })

  it("falha nunca recolhe sozinha, nem fora da viewport", () => {
    expect(
      shouldAutoCollapseOnSettle({
        ...base,
        failed: true,
        groupInViewport: false,
      }),
    ).toBe(false)
  })
})

describe("settledOkStubLabel · as concluídas não pagam o pato", () => {
  it("plural e singular, com o verbo do gesto", () => {
    expect(settledOkStubLabel(6, false)).toBe("6 concluídas · mostrar")
    expect(settledOkStubLabel(1, false)).toBe("1 concluída · mostrar")
  })

  it("aberto, oferece o caminho de volta", () => {
    expect(settledOkStubLabel(6, true)).toBe("6 concluídas · ocultar")
  })
})
