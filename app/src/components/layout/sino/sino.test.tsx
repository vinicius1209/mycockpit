// As regras de tinta do sino (ADR-271), medidas na marcação: âmbar só no que
// espera você, vermelho só na falha, e sucesso em cinza.

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { SecaoEsperando } from "@/components/layout/sino/SecaoEsperando"
import { SecaoAtividade, type AcoesDaAtividade } from "@/components/layout/sino/SecaoAtividade"
import { esperandoVoce } from "@/lib/sino/esperando"
import { agruparAtividade } from "@/lib/sino/agrupar"
import type { Notification } from "@/store/notifications"

const NOW = new Date(2026, 8, 27, 21, 10).getTime()
const HORA = 3_600_000
const nada = () => {}

const acoes: AcoesDaAtividade = {
  tituloDe: () => "Revisão do PRD de edição",
  projetoDe: () => "frota",
  abrirGrupo: nada,
  abrirItem: nada,
  tirar: nada,
}

function item(n: Partial<Notification> & { id: string }): Notification {
  return {
    kind: "run_done",
    title: "Revisão do PRD de edição",
    subtitle: "Claude Code · frota",
    projectId: "p1",
    convId: "c1",
    origem: "turno",
    ts: NOW - HORA,
    read: false,
    ...n,
  }
}

describe("SecaoEsperando", () => {
  it("sem nada vivo a seção não existe", () => {
    const html = renderToStaticMarkup(
      <SecaoEsperando
        esperando={{ itens: [], total: 0 }}
        now={NOW}
        onAbrir={nada}
        onDispensarProposta={nada}
      />,
    )
    expect(html).toBe("")
  })

  it("o pedido vivo aparece em âmbar, com a conta por conversa", () => {
    const esperando = esperandoVoce({
      pedidos: [
        { id: "r1", tipo: "pergunta", convId: "c1", projectId: "p1", convTitle: "Revisão do PRD de edição", projectName: "frota", resumo: "Comentários" },
        { id: "r2", tipo: "permissao", convId: "c1", projectId: "p1", convTitle: "Revisão do PRD de edição", projectName: "frota", resumo: "rodar bun test" },
      ],
      missoes: [],
      decisoes: [],
      ferramentas: [{ agent: "codex", label: "Codex" }],
      now: NOW,
    })
    const html = renderToStaticMarkup(
      <SecaoEsperando esperando={esperando} now={NOW} onAbrir={nada} onDispensarProposta={nada} />,
    )
    expect(html).toContain("Esperando você")
    expect(html).toContain("Pergunta · Comentários (+1) · frota")
    expect(html).toContain("Codex sem login")
    expect(html.match(/text-st-warning(?!-)/g)?.length).toBeGreaterThanOrEqual(2)
    expect(html).toMatch(/bg-st-warning[^"]*">2</)
  })
})

describe("SecaoAtividade", () => {
  const dias = agruparAtividade(
    [
      item({ id: "a", ts: NOW - 5 * HORA, body: "Revisou o PRD e apontou três lacunas no aceite." }),
      item({ id: "b", ts: NOW - 6 * HORA }),
      item({ id: "c", kind: "question", origem: undefined, subtitle: "Pergunta pendente · ADR · frota", ts: NOW - 6.2 * HORA }),
      item({ id: "d", kind: "run_error", origem: "trabalho", title: "Trabalho em background parou", subtitle: "frota", ts: NOW - 6.1 * HORA }),
    ],
    NOW,
  )
  const html = renderToStaticMarkup(<SecaoAtividade dias={dias} now={NOW} vazio={null} acoes={acoes} />)

  it("a conversa vira uma linha com contagem, recibo e o rastro do que ela pediu", () => {
    expect(html).toContain("2 turnos")
    expect(html).toContain("Revisou o PRD e apontou três lacunas no aceite.")
    expect(html).toContain("1 pergunta")
    expect(html).not.toContain("pendente")
  })

  it("sucesso é cinza e só a falha pinta", () => {
    expect(html).not.toContain("text-st-success")
    expect(html).not.toContain("text-st-warning")
    expect(html.match(/text-st-error/g)).toHaveLength(1)
  })

  it("o trabalho que parou diz de qual conversa, e não que um turno falhou", () => {
    expect(html).toContain("Revisão do PRD de edição · frota")
    expect(html).not.toContain("turno falhou")
  })

  it("o ponto de não visto usa a tinta do texto, não a do gesto", () => {
    expect(html).toContain("bg-foreground")
    expect(html).not.toContain("bg-brass")
  })
})
