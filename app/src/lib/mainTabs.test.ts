// Quais abas existem e quando a tira aparece.
//
// A âncora permanente é decisão de produto e vive no comentário do módulo, não
// num predicado: por isso aqui não há teste de "a tira aparece?" — ele só podia
// afirmar `true === true`. O que dá pra afirmar é a LISTA: a conversa nunca sai
// dela, e nunca fecha.

import { describe, expect, it } from "vitest"
import { latestCompletedTurnId, mainTabEntries, type MainTab } from "./mainTabs"

const conversa: MainTab = { kind: "conversa" }
const diff: MainTab = { kind: "diff" }

describe("mainTabEntries", () => {
  it("a conversa está sempre lá: ela é o fundo, não um item que entra e sai", () => {
    expect(mainTabEntries(conversa).map((e) => e.kind)).toEqual(["conversa"])
    expect(mainTabEntries(diff).map((e) => e.kind)).toEqual(["conversa", "diff"])
  })

  it("a conversa NÃO fecha; a do diff, sim", () => {
    const [conv, alt] = mainTabEntries(diff)
    expect(conv.closable).toBe(false)
    expect(alt.closable).toBe(true)
  })

  it("a ordem é estável: a conversa vem primeiro sempre", () => {
    expect(mainTabEntries(diff)[0].kind).toBe("conversa")
  })

  it("focusPath não muda a lista de abas (é estado DENTRO da aba)", () => {
    const comFoco: MainTab = { kind: "diff", focusPath: "src/x.ts" }
    expect(mainTabEntries(comFoco)).toEqual(mainTabEntries(diff))
  })
})

describe("latestCompletedTurnId", () => {
  it("escolhe o resultado mais recente", () => {
    expect(
      latestCompletedTurnId([
        { id: "u1", kind: "user" },
        { id: "r1", kind: "result" },
        { id: "u2", kind: "user" },
        { id: "r2", kind: "result" },
      ]),
    ).toBe("r2")
  })

  it("nota posterior não muda silenciosamente o ponto de corte", () => {
    expect(
      latestCompletedTurnId([
        { id: "r1", kind: "result" },
        { id: "n1", kind: "note" },
      ]),
    ).toBe("r1")
  })

  it("sem turno concluído, não oferece fork", () => {
    expect(latestCompletedTurnId([{ id: "u1", kind: "user" }])).toBeNull()
    expect(latestCompletedTurnId([])).toBeNull()
  })
})
