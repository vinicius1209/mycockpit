// O título que o instrumento mostra é o VIGENTE, não a cópia congelada no feed
// (ADR-142). O incidente original: a conversa foi renomeada no SQLite e o HUD
// continuou mostrando o nome antigo guardado no evento de notificação.
//
// Isto virou pré-requisito da nomeação automática: o helper renomeia a conversa
// DEPOIS que o evento de fim de turno já foi empilhado, então sem esta
// resolução o nome novo nunca apareceria na bandeja nem no HUD.

import { describe, expect, it } from "vitest"
import { conversationTitle } from "./traySnapshot"

const mapa = {
  p1: [{ id: "c1", title: "Autoscroll do fio" }],
  p2: [{ id: "c2", title: "Parse do turn_costs" }],
}

describe("conversationTitle (ADR-142)", () => {
  it("acha pelo projeto dono quando ele é conhecido", () => {
    expect(conversationTitle(mapa, "c1", "p1")).toBe("Autoscroll do fio")
  })

  it("acha em outro projeto quando o dono não foi informado", () => {
    // turno que rodou em background num projeto não-ativo
    expect(conversationTitle(mapa, "c2")).toBe("Parse do turn_costs")
  })

  it("acha mesmo com o projeto ERRADO informado", () => {
    expect(conversationTitle(mapa, "c2", "p1")).toBe("Parse do turn_costs")
  })

  it("conversa não carregada devolve null, e quem chama usa a cópia do feed", () => {
    expect(conversationTitle(mapa, "desconhecida", "p1")).toBeNull()
  })

  it("título nulo não vira string vazia no instrumento", () => {
    expect(conversationTitle({ p1: [{ id: "c9", title: null }] }, "c9", "p1")).toBeNull()
  })
})
