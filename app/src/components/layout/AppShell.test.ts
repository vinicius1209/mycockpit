// A caixa de superfície do cartão do centro.
//
// Isto parece teste de string, e é — de propósito. O build #241 quebrou porque
// UM dos quatro hosts saiu sem `flex flex-col`: o filho que se declara `flex-1`
// deixou de ser item de flex, cresceu até a altura do conteúdo (um diff de
// 1.400 linhas) e vazou. O cartão escondeu o vazamento, mas ele deixou cartão e
// painel roláveis POR SCRIPT — e um `scrollIntoView` empurrou a janela inteira
// pra fora da vista, sem barra nenhuma pra trazer de volta.
//
// As quatro partes só funcionam JUNTAS, então o que este teste protege é a
// constante existir inteira, e não cada host repetir a string na mão.

import { describe, expect, it } from "vitest"
import { HOST_SUPERFICIE } from "./AppShell"

describe("HOST_SUPERFICIE", () => {
  it("é container FLEX: sem isto o `flex-1` do filho é inerte", () => {
    expect(HOST_SUPERFICIE).toContain("flex")
    expect(HOST_SUPERFICIE).toContain("flex-col")
  })

  it("ocupa o vão e pode ENCOLHER abaixo do conteúdo", () => {
    // `flex-1` sem `min-h-0` não encolhe (o mínimo automático é o conteúdo), e
    // aí o vazamento acontece do mesmo jeito, por outro caminho.
    expect(HOST_SUPERFICIE).toContain("flex-1")
    expect(HOST_SUPERFICIE).toContain("min-h-0")
  })

  it("não carrega altura fixa junto (quem manda é o vão do flex)", () => {
    expect(HOST_SUPERFICIE).not.toContain("h-full")
    expect(HOST_SUPERFICIE).not.toContain("h-screen")
  })
})
