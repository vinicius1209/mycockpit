// O RECIBO DO TURNO não pode ficar mais pobre no motor que reporta menos.
//
// Estes testes nascem de um achado de review: o bloco final virou
// `{it.costUsd != null && …}` com o modelo dentro do `title` desse mesmo
// elemento. Em `codex` e `agy` (`reportsCost: false`), um turno de
// `cost_source: "unknown"` fazia o elemento sumir — e com ele a ÚNICA menção ao
// modelo que rodou. Degradação na direção errada: quem informa menos passava a
// mostrar menos ainda.
//
// A regra que estes testes seguram: a ponta direita do recibo nunca fica vazia
// quando há o que dizer, e o modelo não depende do custo pra existir.

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TurnTelemetry } from "./TurnTelemetry"
import type { ChatItem } from "@/store/chat"

type Result = Extract<ChatItem, { kind: "result" }>

function recibo(patch: Partial<Result> = {}) {
  const it = {
    kind: "result",
    id: "r1",
    ok: true,
    durationMs: 1200,
    costSource: "reported",
    ...patch,
  } as Result
  return renderToStaticMarkup(createElement(TurnTelemetry, { it }))
}

describe("TurnTelemetry · a ponta do recibo", () => {
  it("com custo, o custo é o visível e o modelo vai pro tooltip", () => {
    const html = recibo({ costUsd: 0.42, model: "opus-5" })
    expect(html).toContain("Modelo: opus-5")
    // o modelo NÃO aparece como texto quando o custo ocupa a ponta
    expect(html).not.toMatch(/>opus-5</)
  })

  // `costUsd` é `number | undefined` no contrato do item, e o componente checa
  // com `!= null` (pega os dois). "Sem custo" aqui é a ausência do campo, que é
  // o que um motor sem `reportsCost` de fato produz.
  it("SEM custo, o modelo assume o lugar visível em vez de sumir", () => {
    const html = recibo({ costUsd: undefined, model: "gemini-3.8-flash" })
    expect(html).toContain("gemini-3.8-flash")
  })

  it("custo indefinido (motor que não reporta) também mostra o modelo", () => {
    const html = recibo({ model: "gpt-5.3-codex", costSource: "unknown" })
    expect(html).toContain("gpt-5.3-codex")
  })

  it("sem custo E sem modelo, a ponta simplesmente não existe", () => {
    const html = recibo({ costUsd: undefined })
    expect(html).toContain("concluído")
    expect(html).not.toContain("tabular-nums\">$")
  })

  it("custo estimado continua se declarando estimado", () => {
    const html = recibo({ costUsd: 0.1, model: "m", costSource: "estimated" })
    expect(html).toContain("estimado: tokens × tabela de preço")
  })

  it("o desfecho e a duração seguem valendo em qualquer combinação", () => {
    for (const patch of [
      { costUsd: 0.5, model: "m" },
      { costUsd: undefined, model: "m" },
      { costUsd: undefined },
    ]) {
      const html = recibo(patch)
      expect(html).toContain("concluído")
      // `fmtDuration` dá segundo INTEIRO (§6): 1200ms lê "1s", não "1.2s".
      expect(html).toContain(">1s<")
    }
  })
})
