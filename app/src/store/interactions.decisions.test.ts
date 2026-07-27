// Testes do número de DECISÕES da bandeja (awaitingDecisionCount).
//
// A régua: a bandeja diz quanto TRABALHO te espera, não quantas mensagens o
// agente mandou. Um turno pode pedir 20 `Bash` idênticos e um clique em "Aprovar
// todas" zerar os 20 — anunciar "20 decisões" para uma decisão só infla o número
// que deveria te orientar. É a mesma colapsagem que o aviso já faz por episódio
// e o card por assinatura.

import { describe, expect, it } from "vitest"
import type { InteractionRequest } from "@/lib/interaction"
import { awaitingDecisionCount } from "./interactions"

const chat = {
  byId: {
    cx: { runId: "run-1" },
    cy: { runId: "run-2" },
  },
}
const missions = {
  byConv: {
    cm: { id: "m1", current: 1, phases: [{}, {}, {}] },
  },
}

function aprovacao(id: string, runId: string, command = "ls"): InteractionRequest {
  return {
    id,
    run_id: runId,
    kind: "approval",
    data: { tool_name: "Bash", command, input: {} },
  }
}

function pergunta(id: string, runId: string | null): InteractionRequest {
  return {
    id,
    run_id: runId ?? undefined,
    kind: "question",
    data: {
      questions: [
        { header: "H", question: "Q?", multiSelect: false, options: [] },
      ],
    },
  }
}

describe("awaitingDecisionCount", () => {
  it("fila vazia não anuncia nada", () => {
    expect(awaitingDecisionCount([], chat, missions)).toBe(0)
  })

  it("20 pedidos IDÊNTICOS da mesma conversa = 1 decisão", () => {
    // o caso que motivou o helper: "Aprovar todas" resolve os 20 num clique.
    const fila = Array.from({ length: 20 }, (_, i) =>
      aprovacao(`a${i}`, "run-1", "rm -rf dist"),
    )
    expect(awaitingDecisionCount(fila, chat, missions)).toBe(1)
  })

  it("pedidos DIFERENTES da mesma conversa também = 1 (é uma conversa parada)", () => {
    const fila = [
      aprovacao("a1", "run-1", "ls"),
      aprovacao("a2", "run-1", "git push"),
      pergunta("q1", "run-1"),
    ]
    expect(awaitingDecisionCount(fila, chat, missions)).toBe(1)
  })

  it("conversas distintas somam", () => {
    const fila = [aprovacao("a1", "run-1"), aprovacao("a2", "run-2")]
    expect(awaitingDecisionCount(fila, chat, missions)).toBe(2)
  })

  it("pergunta conta igual à permissão (as duas param o turno)", () => {
    expect(awaitingDecisionCount([pergunta("q1", "run-1")], chat, missions)).toBe(1)
  })

  it("fase de missão conta pela conversa dona", () => {
    const fila = [
      aprovacao("a1", "m1::phase-1"),
      pergunta("q1", "m1::phase-1"),
    ]
    expect(awaitingDecisionCount(fila, chat, missions)).toBe(1)
  })

  it("pedido ÓRFÃO conta como um — não pode sumir do total", () => {
    // sem dono resolvível o card ainda está na tela esperando você; zerar o
    // contador esconderia um turno parado.
    const fila = [pergunta("q1", null), pergunta("q2", null)]
    expect(awaitingDecisionCount(fila, chat, missions)).toBe(2)
  })

  it("órfão e conversa real convivem no total", () => {
    const fila = [aprovacao("a1", "run-1"), pergunta("q1", null)]
    expect(awaitingDecisionCount(fila, chat, missions)).toBe(2)
  })

  it("run MORTO (não é o runId corrente de ninguém) conta como órfão", () => {
    expect(
      awaitingDecisionCount([aprovacao("a1", "run-fantasma")], chat, missions),
    ).toBe(1)
  })
})
