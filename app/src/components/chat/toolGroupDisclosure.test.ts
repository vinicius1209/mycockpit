// Regra de disclosure dos grupos (despoluição do fio, direção B): o passado
// custa UMA linha; só o vivo fica aberto; a falha não se esconde; e o
// recolhimento automático nunca puxa o tapete de quem está lendo.
import { describe, expect, it } from "vitest"
import {
  ABRE_APOS_MS,
  bornOpen,
  detailBornOpen,
  esperaParaAbrir,
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

describe("esperaParaAbrir · só a ação que dura abre o grupo", () => {
  // Carimbos REAIS de um turno do Claude Code (conversation_items, 01/10):
  // a leitura de um print levou 87ms; o primeiro grep, 1.840ms.
  const LEITURA = 1_790_867_025_228
  const GREP = 1_790_867_029_127

  it("leitura de 87ms termina antes de o grupo abrir", () => {
    expect(esperaParaAbrir(LEITURA, LEITURA + 87)).toBe(ABRE_APOS_MS - 87)
  })

  it("comando que passa de 1s abre o grupo", () => {
    expect(esperaParaAbrir(GREP, GREP + ABRE_APOS_MS)).toBe(0)
    expect(esperaParaAbrir(GREP, GREP + 1_840)).toBe(0)
  })

  it("sem carimbo a ação já estava aí (histórico, remontagem) e abre já", () => {
    expect(esperaParaAbrir(undefined, GREP)).toBe(0)
    expect(esperaParaAbrir(null, GREP)).toBe(0)
  })

  it("relógio que andou para trás espera a régua inteira, sem abrir antes", () => {
    expect(esperaParaAbrir(GREP + 5_000, GREP)).toBe(ABRE_APOS_MS)
  })
})

describe("detailBornOpen · teto no bloco de comando (a régua do briefing)", () => {
  it("comando de uma linha continua aberto (o caso comum, sem clique extra)", () => {
    expect(detailBornOpen(1)).toBe(true)
  })

  it("de duas linhas pra cima nasce recolhido", () => {
    expect(detailBornOpen(2)).toBe(false)
  })

  it("heredoc longo não empurra o estado vivo pra fora da viewport", () => {
    expect(detailBornOpen(34)).toBe(false)
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
