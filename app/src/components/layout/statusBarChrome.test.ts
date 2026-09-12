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

  it("todos usam o chrome, sem exceção", () => {
    // Este teste já teve uma fresta: aceitava "usa o chrome OU repete a
    // geometria dele", e o `UsagePill` vivia dentro dela, com a justificativa
    // de que o gatilho era a própria pill. A justificativa não se sustentava
    // (o chrome recebe o gatilho por `children`); a diferença real era só
    // `side`/`align`, que agora são parâmetro. Guarda com escape opcional
    // legitima a divergência que ela existe pra impedir.
    for (const arquivo of PAINEIS_DA_FAIXA) {
      const fonte = FONTES[arquivo]
      expect(fonte, `${arquivo} não usa o PainelDaFaixa`).toContain(
        "PainelDaFaixa",
      )
    }
  })

  it("o chrome compartilhado existe e é quem carrega a regra", () => {
    const chrome = FONTES["./statusBarChrome.tsx"]
    expect(chrome).toBeTruthy()
    expect(chrome).toContain("PainelDaFaixa")
    expect(chrome).toContain("LinhaDoPainel")
  })

  it("a primeira ação do medidor não expõe o outline nativo do WebView", () => {
    const medidor = FONTES["./UsagePill.tsx"]
    expect(medidor).toContain('import { Button } from "@/components/ui/button"')

    const acao = medidor.slice(
      medidor.indexOf("acao={"),
      medidor.indexOf("nota={"),
    )
    expect(acao).toContain('<Button')
    expect(acao).not.toContain('<button')
  })
})
