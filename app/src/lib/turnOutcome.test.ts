// Saída de emergência do composer: depois de um turno que FALHOU, o MODELO
// destrava e a conversa deixa de ser um beco.
//
// O incidente que motivou (14/08/2026): um parser velho de `agy models` colou o
// rótulo no slug, o agy recusou LOCALMENTE todo envio ("model … is not
// recognized as a known model") e o usuário ficou preso — a identidade da
// conversa trava no 1º envio, então o seletor de modelo estava desabilitado com
// o valor corrompido dentro. Reenviar repetia o mesmo erro; a única saída era
// trocar de AGENT no card do incidente, jogando fora a escolha de modelo.
//
// A régua é `lastExecutorTurnFailed`: o composer a usa pra destravar o seletor
// e pra marcar `modelSwitched` no envio; o despacho (ChatPanel) só obedece à
// flag. Régua num lugar só, senão a UI ofereceria uma escolha que o envio
// descartaria em silêncio.

import { describe, expect, it } from "vitest"

import {
  lastExecutorTurnFailed,
  lastExecutorTurnOutcome,
  pendingExecutorRequest,
} from "@/lib/turnOutcome"
import type { ChatItem } from "@/store/chat"

const user: ChatItem = { kind: "user", id: "u1", text: "roda os testes" }
const ok: ChatItem = { kind: "result", id: "r1", ok: true, text: "pronto" }

function erro(message: string): ChatItem {
  return { kind: "error", id: "e1", message }
}

/** O erro REAL do incidente, como chegou no fio. */
const ERRO_DO_AGY =
  'invalid model selection (--model "gemini-3.7-flash-high\tGemini 3.7 Flash (High)" --effort ""): ' +
  "model gemini-3.7-flash-high\tGemini 3.7 Flash (High) is not recognized as a known model"

describe("saída de emergência: destravar o modelo depois de um turno que falhou", () => {
  it("último item de erro destrava (o caso do slug corrompido do agy)", () => {
    expect(lastExecutorTurnFailed([user, erro(ERRO_DO_AGY)])).toBe(true)
  })

  it("teto de uso também destrava (trocar de modelo é a saída honesta)", () => {
    const limite: ChatItem = {
      kind: "limit",
      id: "l1",
      message: "limite de uso atingido",
      resetHint: "volta às 15h",
    }
    expect(lastExecutorTurnFailed([user, limite])).toBe(true)
  })

  it("result de falha isolado também é terminal e destrava", () => {
    const failed: ChatItem = {
      kind: "result",
      id: "r-failed",
      ok: false,
      text: "o provider encerrou antes do erro estruturado",
    }
    expect(lastExecutorTurnFailed([user, failed])).toBe(true)
    expect(lastExecutorTurnOutcome([user, failed])).toEqual({
      kind: "failed",
      terminalId: "r-failed",
    })
  })

  it("turno que deu certo NÃO destrava (a identidade da conversa continua fixa)", () => {
    expect(lastExecutorTurnFailed([user, ok])).toBe(false)
    expect(lastExecutorTurnOutcome([user, ok])).toEqual({
      kind: "succeeded",
      terminalId: "r1",
    })
  })

  it("conversa vazia não destrava nada (não há turno anterior)", () => {
    expect(lastExecutorTurnFailed([])).toBe(false)
  })

  it("erro ANTIGO com turno bom depois volta a travar", () => {
    // o que vale é o ÚLTIMO turno: a conversa se recuperou, não há emergência.
    expect(lastExecutorTurnFailed([user, erro("falhou"), user, ok])).toBe(false)
  })

  it("parecer de conselheiro depois do erro não esconde a falha", () => {
    // `advice` é lateral e não conta como turno de executor (E1) — consultar um
    // especialista sobre o erro não pode fechar a saída de emergência.
    const parecer: ChatItem = {
      kind: "advice",
      id: "a1",
      personaId: "projeto:aline",
      personaName: "Aline",
      personaVersion: 1,
      digest: "deadbeef",
      question: "e agora?",
      text: "troca o modelo",
    }
    expect(lastExecutorTurnFailed([user, erro(ERRO_DO_AGY), parecer])).toBe(true)
  })
})

describe("pedido pendente do executor", () => {
  it("ignora a pergunta posterior dirigida a um Especialista", () => {
    const attachment = {
      path: "attachments/c1/erro.png",
      name: "erro.png",
      kind: "image" as const,
      mime: "image/png",
      bytes: 800,
    }
    const advisorQuestion: ChatItem = {
      kind: "user",
      id: "u-advice",
      text: "Aline, o que você acha?",
      advisorTo: { id: "aline", name: "Aline" },
    }
    const items: ChatItem[] = [
      { ...user, attachments: [attachment] },
      erro("falhou"),
      advisorQuestion,
    ]

    expect(pendingExecutorRequest(items)).toEqual({
      index: 0,
      text: "roda os testes",
      attachments: [attachment],
    })
  })

  it("não inventa pedido numa conversa composta só por parecer", () => {
    expect(
      pendingExecutorRequest([
        {
          kind: "user",
          id: "u-advice",
          text: "revise",
          advisorTo: { id: "aline", name: "Aline" },
        },
      ]),
    ).toBeNull()
  })
})
