// O CARTÃO DE DECISÃO PENDENTE NÃO USA A TINTA DO GESTO.
//
// Este é o fluxo de aprovação humana, que é a doutrina do produto: o agent quer
// executar um comando na máquina e o turno está PARADO até você responder. Até
// 15/08/2026 os três cartões desse fluxo eram `border-brass/40 bg-brass/[0.07]`
// — brass, que o §2 reserva pro GESTO — enquanto o ponto do slot da conversa
// (`ConversationSlot`, `bg-st-warning`) e os ícones do inbox (`InboxBell`,
// `text-st-warning`) já falavam âmbar pros MESMOS pedidos. A trilha trocava de
// cor no último passo, bem onde se decide.
//
// A regressão que este teste pega é barata de cometer: `bg-brass` e
// `bg-st-warning` estão a 1,2° de matiz no tema escuro (ADR-043), então voltar
// atrás não aparece numa olhada, só numa medição. Por isso a asserção é sobre a
// CLASSE do contêiner, não sobre "parece âmbar".
//
// Renderização server-side (`renderToStaticMarkup`), que é o que o repo tem:
// sem jsdom, sem testing-library. Serve pro que importa aqui, porque a
// marcação do contêiner é função pura das props.
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { InteractionCard } from "@/components/chat/InteractionHost"
import { PENDING_DECISION } from "@/lib/attention"
import type { InteractionRequest } from "@/lib/interaction"
import { useInteractions } from "@/store/interactions"

const APROVACAO: InteractionRequest = {
  id: "req-1",
  run_id: "run-1",
  kind: "approval",
  data: {
    tool_name: "Bash",
    command: "deno run -A v2-compat.smoke.ts",
    input: { command: "deno run -A v2-compat.smoke.ts" },
  },
}

const PERGUNTA: InteractionRequest = {
  id: "req-2",
  run_id: "run-1",
  kind: "question",
  data: {
    questions: [
      {
        header: "banco",
        question: "Qual banco usar no ambiente de teste?",
        multiSelect: false,
        options: [
          { label: "SQLite em memória", description: "some no fim do processo" },
          { label: "Postgres em container" },
        ],
      },
    ],
  },
}

/** A primeira `<div>` do markup é o contêiner do cartão. */
function containerDe(req: InteractionRequest, compact = false) {
  const html = renderToStaticMarkup(<InteractionCard req={req} compact={compact} />)
  const m = html.match(/^<div class="([^"]*)"/)
  if (!m) throw new Error(`sem contêiner com classe no markup: ${html.slice(0, 200)}`)
  return m[1]
}

beforeEach(() => {
  useInteractions.setState({ queue: [APROVACAO, PERGUNTA] })
})

afterEach(() => {
  useInteractions.setState({ queue: [] })
})

describe("cartões do fluxo de aprovação", () => {
  const casos: [string, InteractionRequest, boolean][] = [
    ["pedido de permissão (inline, na conversa dona)", APROVACAO, false],
    ["pedido de permissão (compacto, toast global)", APROVACAO, true],
    ["pergunta do agent (formulário inline)", PERGUNTA, false],
    ["pergunta do agent (teaser do toast global)", PERGUNTA, true],
  ]

  for (const [nome, req, compact] of casos) {
    it(`${nome} usa a superfície de decisão pendente`, () => {
      const classes = containerDe(req, compact)
      for (const parte of PENDING_DECISION.split(" ")) {
        expect(classes).toContain(parte)
      }
    })

    it(`${nome} não pinta o contêiner com a tinta do gesto`, () => {
      const classes = containerDe(req, compact).split(" ")
      // Preenchimento e borda: o brass do cartão inteiro era o desvio. O botão
      // primário DENTRO do cartão segue brass de propósito, e por isso a
      // asserção olha só o contêiner.
      expect(classes.filter((c) => /^(bg|border)-brass/.test(c))).toEqual([])
    })
  }

  it("a superfície de decisão pendente é âmbar, e não o brass nem o verde", () => {
    expect(PENDING_DECISION).toContain("st-warning")
    expect(PENDING_DECISION).not.toContain("brass")
    expect(PENDING_DECISION).not.toContain("st-success")
  })
})
