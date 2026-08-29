import { describe, expect, it } from "vitest"

/**
 * A faixa tem UM idioma pro clique, e este teste é o que impede o segundo de
 * nascer de novo.
 *
 * O defeito real: `WorktreesDialog` abria um dialog centrado e o `UsagePill`
 * subia um painel ancorado. Mesma barra, mesmo gesto, duas gramáticas — e a
 * diferença não tinha decisão por trás, era só quem copiou qual vizinho. Quem
 * escrever o próximo item da faixa vai copiar um deles; se copiar um dialog, a
 * suíte reclama aqui.
 */
const FONTES = import.meta.glob("./*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

/** Os painéis abertos POR item da faixa de status. */
const PAINEIS_DA_FAIXA = [
  "./ProcessosPopover.tsx",
  "./WorktreesPainel.tsx",
  "./UsagePill.tsx",
]

describe("o idioma do painel da faixa", () => {
  it("nenhum painel da faixa abre Dialog", () => {
    for (const arquivo of PAINEIS_DA_FAIXA) {
      const fonte = FONTES[arquivo]
      expect(fonte, `${arquivo} não foi lido`).toBeTruthy()
      expect(fonte, `${arquivo} voltou a usar Dialog`).not.toContain(
        "@/components/ui/dialog",
      )
    }
  })

  it("ou usam o chrome, ou repetem a geometria dele", () => {
    // O `UsagePill` não usa o componente porque o gatilho dele é a própria
    // pill, com estado de leitura dentro. Ele paga o preço de repetir a
    // geometria — e este teste é quem cobra que ela continue a MESMA.
    for (const arquivo of PAINEIS_DA_FAIXA) {
      const fonte = FONTES[arquivo]
      const usaChrome = fonte.includes("PainelDaFaixa")
      const repeteGeometria =
        fonte.includes("sideOffset={8}") && fonte.includes('side="top"')
      expect(
        usaChrome || repeteGeometria,
        `${arquivo} não usa o PainelDaFaixa nem repete a geometria dele`,
      ).toBe(true)
    }
  })

  it("o chrome compartilhado existe e é quem carrega a regra", () => {
    const chrome = FONTES["./statusBarChrome.tsx"]
    expect(chrome).toBeTruthy()
    expect(chrome).toContain("PainelDaFaixa")
    expect(chrome).toContain("LinhaDoPainel")
  })
})
