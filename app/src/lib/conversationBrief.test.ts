import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import { briefExcerpt, conversationBrief } from "./conversationBrief"

// Recorte literal de app/src/test/fio-real.json, colhido de uma conversa real.
const PEDIDO_REAL: ChatItem = {
  kind: "user",
  id: "bb536013-2d53-4df6-9644-d23b4f1ae5a1",
  text: "Preciso que voce reveja esse projeto /Users/viniciusmachado/projetos/pessoais/finance-monitor :\n\n1) Features\n2) Arquitetura\n3) Pontos de melhoria\n4) entenda a dor que ele resolve, proponha novas funcionalidades",
  ts: 1785711201391,
}

const ENTREGA_REAL: ChatItem = {
  kind: "text",
  id: "c179fe47-26a0-42df-bb8d-c08e8bc6b832",
  text: "Frontend (`web`) já buildou e exportou a imagem. A API ainda está baixando a imagem base do Maven e depois compila o jar.",
  ts: 1785711693523,
}

const RESULTADO_REAL: ChatItem = {
  kind: "result",
  id: "b48b0a7f-6edb-43a2-8f76-9cfa49916d7e",
  ok: true,
  text: "Frontend (`web`) já buildou e exportou a imagem. A API ainda está baixando a imagem base do Maven e depois compila o jar.",
  ts: 1785711696553,
}

describe("a memória operacional da conversa", () => {
  it("preserva o pedido inicial e só publica uma resposta concluída como checkpoint", () => {
    const brief = conversationBrief(
      [PEDIDO_REAL, ENTREGA_REAL, RESULTADO_REAL],
      "Revisar finance-monitor",
    )

    expect(brief.title).toBe("Revisar finance-monitor")
    expect(brief.initialRequest?.text).toContain("Preciso que voce reveja")
    expect(brief.initialRequest?.ts).toBe(1785711201391)
    expect(brief.checkpoint).toEqual({
      text: RESULTADO_REAL.text,
      ts: 1785711696553,
    })
  })

  it("não promove streaming parcial nem resposta de turno que falhou", () => {
    expect(conversationBrief([PEDIDO_REAL, ENTREGA_REAL], null).checkpoint).toBeNull()
    expect(
      conversationBrief(
        [
          PEDIDO_REAL,
          ENTREGA_REAL,
          { kind: "error", id: "erro-real", message: "processo encerrou", ts: 1785711696553 },
        ],
        null,
      ).checkpoint,
    ).toBeNull()
  })

  it("mantém o checkpoint anterior enquanto um novo turno ainda está aberto", () => {
    const brief = conversationBrief(
      [
        PEDIDO_REAL,
        ENTREGA_REAL,
        RESULTADO_REAL,
        { kind: "user", id: "u2", text: "Continue a validação.", ts: 1785711700000 },
        { kind: "text", id: "t2", text: "Ainda verificando.", ts: 1785711701000 },
      ],
      null,
    )

    expect(brief.checkpoint?.text).toBe(RESULTADO_REAL.text)
  })

  it("encurta só a projeção visual e declara o corte", () => {
    expect(briefExcerpt("uma\n\nfrase   longa", 12)).toBe("uma frase…")
  })
})
