import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import {
  deterministicConversationFacts,
  latestCanonicalOutcome,
  settledConversationTurns,
} from "./facts"

// Recorte sanitizado de src/test/fio-real.json: ids e sequência são de um run
// real; só o texto foi encurtado para o teste declarar a intenção com clareza.
const PEDIDO: ChatItem = {
  kind: "user",
  id: "bb536013-2d53-4df6-9644-d23b4f1ae5a1",
  text: "Preciso que você reveja esse projeto.",
  ts: 1_785_711_201_391,
}
const RESPOSTA: ChatItem = {
  kind: "text",
  id: "ad2f33aa-98e9-4196-9ee5-87e9f2b96d0c",
  text: "Vou revisar a arquitetura e validar a execução.",
  ts: 1_785_711_210_751,
}
const RESULTADO: ChatItem = {
  kind: "result",
  id: "b48b0a7f-6edb-43a2-8f76-9cfa49916d7e",
  ok: true,
  ts: 1_785_711_696_553,
}

describe("fatos determinísticos do mapa da conversa", () => {
  it("preserva o primeiro pedido ao executor e ignora pergunta lateral", () => {
    const advisor: ChatItem = {
      kind: "user",
      id: "advisor-question",
      text: "O que você acha?",
      advisorTo: { id: "aline", name: "Aline" },
    }
    const facts = deterministicConversationFacts({
      conversationId: "conv-real",
      title: "Revisão",
      items: [advisor, PEDIDO, RESPOSTA, RESULTADO],
      runtime: { running: false, finalizing: false },
    })

    expect(facts.initialSubject?.itemId).toBe(PEDIDO.id)
    expect(facts.latestOutcome?.status).toBe("succeeded")
    expect(facts.latestOutcome?.terminalItemId).toBe(RESULTADO.id)
  })

  it("não atribui o desfecho anterior ao turno que está em voo", () => {
    const next: ChatItem = {
      kind: "user",
      id: "pedido-seguinte",
      text: "Agora confira os dados do painel.",
      ts: RESULTADO.ts! + 1,
    }
    expect(
      latestCanonicalOutcome([PEDIDO, RESPOSTA, RESULTADO, next], {
        running: true,
        finalizing: false,
      }),
    ).toBeNull()
  })

  it("mostra o terminal quando ele pertence ao pedido mais recente", () => {
    expect(
      latestCanonicalOutcome([PEDIDO, RESPOSTA, RESULTADO], {
        running: false,
        finalizing: false,
      }),
    ).toMatchObject({ terminalItemId: RESULTADO.id, status: "succeeded" })
  })

  it("assenta pelo terminal real e mantém a cauda aberta fora do watermark", () => {
    const tail: ChatItem = {
      kind: "user",
      id: "novo-pedido",
      text: "Agora valide o frontend.",
      ts: 2_000,
    }
    const turns = settledConversationTurns(
      [PEDIDO, RESPOSTA, RESULTADO, tail],
      { running: true, finalizing: false },
      4_000,
    )

    expect(turns).toHaveLength(1)
    expect(turns[0].terminalItemId).toBe(RESULTADO.id)
  })

  it("assenta fala humana sem run somente depois do debounce", () => {
    const lone: ChatItem = { kind: "user", id: "u", text: "Uma ideia", ts: 1_000 }
    expect(
      settledConversationTurns([lone], { running: false, finalizing: false }, 1_500),
    ).toEqual([])
    expect(
      settledConversationTurns([lone], { running: false, finalizing: false }, 1_701),
    ).toMatchObject([{ terminalItemId: "u", status: "unknown" }])
  })

  it("não perde uma fala humana quando outra abre o turno seguinte", () => {
    const second: ChatItem = { kind: "user", id: "u2", text: "Outra ideia", ts: 2_000 }
    expect(
      settledConversationTurns(
        [{ kind: "user", id: "u1", text: "Uma ideia", ts: 1_000 }, second],
        { running: true, finalizing: false },
        3_000,
      ),
    ).toMatchObject([{ terminalItemId: "u1", status: "unknown" }])
  })
})
