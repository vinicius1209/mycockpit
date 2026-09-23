// A tela de encerramento (ADR-235). O payload é o que o Rust emite em
// `quit://encerrando` (camelCase, sem campo vazio: ver
// `encerramento::tests::o_item_vai_a_tela_em_camel_case_sem_campos_vazios`).
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it } from "vitest"
import { ListaDoEncerramento, linhasDoEncerramento } from "./TelaDeEncerramento"
import { useEncerramento } from "@/store/encerramento"
import { useChat } from "@/store/chat"

const DO_RUST = [
  { id: "run:r1", tipo: "run" as const, rotulo: "Tarefa do agente", runId: "r1" },
  { id: "processo:p1", tipo: "processo" as const, rotulo: "npx vite --port 3000", convId: "c1" },
  { id: "processo:p2", tipo: "processo" as const, rotulo: "Navegador do projeto" },
]

beforeEach(() => {
  useEncerramento.setState({ itens: null, pronto: false })
  useChat.setState({
    byId: { c1: { runId: "r1" } } as never,
    conversationsByProject: { p: [{ id: "c1", title: "Landing da Prime" }] } as never,
  })
})

describe("encerramento", () => {
  it("tudo nasce encerrando; só muda o item que o Rust confirmou", () => {
    useEncerramento.getState().comecar(DO_RUST)
    useEncerramento.getState().marcar("processo:p1", "encerrado")
    const estados = useEncerramento.getState().itens!.map((i) => [i.id, i.estado])
    expect(estados).toEqual([
      ["run:r1", "encerrando"],
      ["processo:p1", "encerrado"],
      ["processo:p2", "encerrando"],
    ])
  })

  it("a tarefa aparece pelo título da conversa, e o processo diz de qual conversa é", () => {
    useEncerramento.getState().comecar(DO_RUST)
    const linhas = linhasDoEncerramento(useEncerramento.getState().itens!)
    expect(linhas[0]).toMatchObject({ titulo: "Landing da Prime", detalhe: "tarefa do agente" })
    expect(linhas[1]).toMatchObject({ titulo: "npx vite --port 3000", detalhe: "Landing da Prime" })
    expect(linhas[2]).toMatchObject({ titulo: "Navegador do projeto", detalhe: null })
  })

  it("mostra quem ainda gira, quem saiu e quem foi à força", () => {
    const html = renderToStaticMarkup(
      <ListaDoEncerramento
        pronto={false}
        linhas={[
          { id: "a", titulo: "Landing da Prime", detalhe: "tarefa do agente", estado: "encerrando" },
          { id: "b", titulo: "npx vite --port 3000", detalhe: null, estado: "encerrado" },
          { id: "c", titulo: "Navegador do projeto", detalhe: null, estado: "forcado" },
        ]}
      />,
    )
    expect(html).toContain("Encerrando o Frota")
    expect(html).toContain("conv-spin")
    expect(html).toContain("encerrado à força")
    expect(html).toContain("1 de 3 ainda encerrando")
    expect(html).not.toContain("—")
  })

  it("no fim, diz que acabou e some a contagem", () => {
    const html = renderToStaticMarkup(
      <ListaDoEncerramento pronto linhas={[{ id: "a", titulo: "x", detalhe: null, estado: "encerrado" }]} />,
    )
    expect(html).toContain("Tudo o que o Frota abriu foi encerrado.")
    expect(html).not.toContain("ainda encerrando")
  })
})
