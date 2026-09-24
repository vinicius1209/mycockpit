import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { FIO } from "@/components/chat/marcosDaRegua.fixture"
import { historicoDePedidos } from "@/lib/conversationMap/historico"
import { HistoricoDePedidos } from "./HistoricoDePedidos"

describe("histórico de pedidos: quem escreveu (ADR-250)", () => {
  const { pedidos } = historicoDePedidos(FIO, { running: false, finalizing: false })
  const html = renderToStaticMarkup(<HistoricoDePedidos pedidos={pedidos} now={1790272600000} onReveal={() => {}} />)

  it("a retomada automática vem rotulada como do app, com o texto que ela mandou", () => {
    expect(html).toContain("Retomada automática · ")
    expect(html).toContain("O turno anterior parou num limite de uso/espera")
  })

  it("pedido seu segue sem rótulo", () => {
    expect(html.match(/Retomada automática/g)).toHaveLength(1)
    expect(html).toContain("pode fazer os commits separados por assunto")
  })
})
