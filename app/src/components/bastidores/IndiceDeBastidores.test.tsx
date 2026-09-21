// Aba "Bastidores" do painel direito (ADR-200): o índice que abre vistas ao lado
// da conversa. Renderiza a apresentação por props.

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { IndiceView } from "./IndiceDeBastidores"
import type { Bastidor } from "@/lib/bastidores"

const T0 = 1_789_578_857_000
const nada = () => {}

const b = (itemId: string, titulo: string, estado: Bastidor["estado"] = "vivo"): Bastidor => ({
  itemId,
  tipo: "tarefa",
  titulo,
  detalhe: null,
  comando: null,
  estado,
  desde: T0,
  atualizadoEm: T0,
  fonte: { tipo: "sem-saida" },
  tokens: null,
})

function render(lista: Bastidor[], abertas: string[], itemEmFoco?: string) {
  return renderToStaticMarkup(
    <IndiceView
      lista={lista}
      abertas={abertas}
      itemEmFoco={itemEmFoco}
      onAbrir={nada}
      onFixar={nada}
      onFecharTodas={nada}
    />,
  )
}

describe("IndiceView", () => {
  it("sem trabalho explica o que vai aparecer aqui, sem lista fingida", () => {
    const html = render([], [])
    expect(html).toContain("Nada em andamento nesta conversa.")
    expect(html).toContain("aparece aqui para você acompanhar ao lado da conversa")
    expect(html).not.toContain("Enter abre")
  })

  it("conta os vivos e mostra o atalho de teclado", () => {
    const html = render([b("a", "deploy"), b("b", "revisão", "concluido")], [])
    expect(html).toContain("1 em andamento nesta conversa")
    // Desde o build #390 o terminal abre na própria aba, não ao lado da conversa.
    expect(html).toContain("Enter abre no terminal")
  })

  it("com vistas abertas, a lista oferece a volta ao terminal", () => {
    const html = renderToStaticMarkup(
      <IndiceView
        lista={[b("a", "deploy")]}
        abertas={["a"]}
        itemEmFoco="a"
        onAbrir={nada}
        onFixar={nada}
        onFecharTodas={nada}
        onVoltar={nada}
      />,
    )
    expect(html).toContain("Voltar ao terminal (1)")
    expect(render([b("a", "deploy")], [])).not.toContain("Voltar ao terminal")
  })

  it("a seleção nasce na vista em foco e o item aberto fica marcado", () => {
    const html = render([b("a", "deploy"), b("b", "revisão")], ["b"], "b")
    const opcoes = html.match(/aria-selected="(true|false)"/g)
    expect(opcoes).toEqual(['aria-selected="false"', 'aria-selected="true"'])
    expect(html).toMatch(/font-medium text-foreground" title="revisão"/)
  })

  it("só terminados: a lista não diz que está vazia por cima deles", () => {
    // Visto na tela em 21/09/2026: "Nada em andamento nesta conversa." em cima
    // de sete linhas concluídas parecia estado vazio contradizendo a lista.
    const html = render([b("a", "deploy", "concluido"), b("b", "revisão", "falhou")], [])
    expect(html).not.toContain("Nada em andamento")
    expect(html.match(/Terminou há pouco/g)).toHaveLength(1)
  })

  it("com vivos e terminados, o rótulo entra uma vez, na fronteira", () => {
    const html = render([b("a", "deploy"), b("b", "revisão", "concluido"), b("c", "lint", "concluido")], [])
    expect(html).toContain("1 em andamento nesta conversa")
    expect(html.indexOf("deploy")).toBeLessThan(html.indexOf("Terminou há pouco"))
    expect(html.indexOf("Terminou há pouco")).toBeLessThan(html.indexOf("revisão"))
    expect(html.match(/Terminou há pouco/g)).toHaveLength(1)
  })

  it("marca o que roda em segundo plano de verdade, e o comando comum fica sem marca", () => {
    const comando: Bastidor = { ...b("c", "Typecheck and run the guide lints", "concluido"), tipo: "comando" }
    const html = render([{ ...b("s", "Explorar o painel"), tipo: "subagente" }, comando], [])
    expect(html).toContain(">subagente<")
    expect(html).not.toContain(">comando<")
  })

  it("o gesto de fixar não reserva largura enquanto está escondido", () => {
    const html = render([b("a", "deploy")], [])
    expect(html).not.toContain("opacity-0")
    expect(html).toContain("group-hover/indice:inline-flex")
  })
})
