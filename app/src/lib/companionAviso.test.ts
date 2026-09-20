import { describe, expect, it } from "vitest"
import {
  avisadosDepois,
  avisoDoTurno,
  decidirAviso,
  episodiosNovos,
  rotaDoEpisodio,
} from "./companionAviso"
import type { CompanionAttention } from "./companionTypes"

const item = (extra: Partial<CompanionAttention> = {}): CompanionAttention => ({
  id: "req-1",
  kind: "approval",
  convId: "c1",
  projectId: "p1",
  projectName: "mycockpit",
  agent: "claude-code",
  phase: null,
  phaseLabel: null,
  ...extra,
})

describe("quando o celular é avisado com a tela fechada", () => {
  it("um pedido novo vira um aviso que diz o que é e de qual Mac", () => {
    const { aviso } = decidirAviso(
      { attention: [item()] },
      { jaAvisados: new Set(), conectados: 0, maquina: "Mac da empresa" },
    )
    expect(aviso).toEqual({
      titulo: "Frota · Mac da empresa",
      corpo: "Aprovação pendente · mycockpit",
      url: "/#/chat/p1/claude-code/c1",
      tag: "atencao:req-1",
    })
  })

  it("o MESMO pedido não avisa duas vezes", () => {
    const attention = [item()]
    const um = decidirAviso({ attention }, { jaAvisados: new Set(), conectados: 0, maquina: null })
    expect(um.aviso).not.toBeNull()
    const dois = decidirAviso({ attention }, { jaAvisados: um.avisados, conectados: 0, maquina: null })
    expect(dois.aviso).toBeNull()
  })

  it("com a página aberta ninguém é acordado, mas o episódio fica marcado", () => {
    const attention = [item()]
    const aberta = decidirAviso({ attention }, { jaAvisados: new Set(), conectados: 1, maquina: null })
    expect(aberta.aviso).toBeNull()
    // Fechar a página depois não pode fazer chover aviso do que já foi visto.
    const fechada = decidirAviso({ attention }, { jaAvisados: aberta.avisados, conectados: 0, maquina: null })
    expect(fechada.aviso).toBeNull()
  })

  it("vários pedidos novos viram UM aviso com a contagem", () => {
    const { aviso } = decidirAviso(
      { attention: [item(), item({ id: "req-2", kind: "question" })] },
      { jaAvisados: new Set(), conectados: 0, maquina: null },
    )
    expect(aviso).toEqual({
      titulo: "Frota",
      corpo: "2 coisas pedem você",
      url: "/",
      tag: "atencao:varias",
    })
  })

  it("episódio resolvido sai da memória, e se voltar avisa de novo", () => {
    const antes = new Set(["req-1"])
    const depois = avisadosDepois([], antes)
    expect(depois.has("req-1")).toBe(false)
    expect(episodiosNovos([item()], depois)).toHaveLength(1)
  })

  it("nada pedindo você não vira aviso nenhum", () => {
    expect(avisoDoTurno([], "Mac")).toBeNull()
    expect(decidirAviso({ attention: [] }, { jaAvisados: new Set(), conectados: 0, maquina: null }).aviso).toBeNull()
  })

  it("pedido sem conversa resolvida abre o início, não uma rota inventada", () => {
    expect(rotaDoEpisodio(item({ convId: null }))).toBe("/")
    expect(rotaDoEpisodio(item({ agent: "" }))).toBe("/")
    expect(rotaDoEpisodio(item())).toBe("/#/chat/p1/claude-code/c1")
  })

  it("cada tipo de pedido diz o que é, com o projeto quando existe", () => {
    const corpo = (extra: Partial<CompanionAttention>) =>
      avisoDoTurno([item(extra)], null)?.corpo
    expect(corpo({ kind: "question" })).toBe("Pergunta do agente · mycockpit")
    expect(corpo({ kind: "gate" })).toBe("Respostas pendentes · mycockpit")
    expect(corpo({ kind: "stalled", projectName: null })).toBe("Turno parado")
  })
})
