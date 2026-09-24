import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { historicoDePedidos } from "@/lib/conversationMap/historico"
import { IndiceDaConversa } from "./IndiceDaConversa"
import { groupByAuthor } from "./messageGroups"
import { buildNodes } from "./messageNodes"
import { marcosDaRegua } from "./marcosDaRegua"
import { FIO } from "./marcosDaRegua.fixture"

const pedidos = historicoDePedidos(FIO, { running: false, finalizing: false }).pedidos
const marcos = marcosDaRegua(groupByAuthor(buildNodes(FIO)), FIO, pedidos)

function html(props: Partial<Parameters<typeof IndiceDaConversa>[0]> = {}) {
  return renderToStaticMarkup(
    <IndiceDaConversa
      marcos={marcos}
      total={pedidos.length}
      ativo={marcos[0].key}
      sobre={null}
      onIr={() => {}}
      onHistorico={() => {}}
      {...props}
    />,
  )
}

describe("índice da conversa (ADR-250)", () => {
  it("cada pedido mostra o que você pediu e o que o agente respondeu", () => {
    const h = html()
    expect(h).toContain("pode fazer os commits separados por assunto, e pode seguir")
    expect(h).toContain("Fiz os commits separados por assunto")
    expect(h).toContain("15min")
  })

  it("a retomada automática aparece como do app, não com o texto na sua boca", () => {
    const h = html()
    expect(h).toContain("Retomada automática")
    expect(h).not.toContain("O turno anterior parou num limite de uso/espera")
  })

  it("o aviso do sistema fica dentro do pedido em que aconteceu", () => {
    expect(html()).toContain("A árvore de processos deste run atingiu 2301 MB")
  })

  it("o pedido da tela é a linha selecionada", () => {
    const h = html({ ativo: marcos[1].key })
    expect(h.match(/aria-current="location"/g)).toHaveLength(1)
    const linhaAtiva = h.slice(h.indexOf('aria-current="location"'))
    expect(linhaAtiva).toContain("1. isso a gente deixa pra depois")
  })

  it("com o começo fora da janela, o cabeçalho diz que a lista é parcial", () => {
    expect(html({ marcos: marcos.slice(1) })).toContain("últimos 2 de 3 pedidos")
    expect(html()).toContain("3 pedidos")
  })
})
