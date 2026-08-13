// Dedup pai×filho da derivação de planos.
//
// `deriveTaskPlans` é O(N) sobre o fio inteiro e rodava DUAS vezes por token do
// streaming (ChatPanel para o plano vivo, MessageList para os marcos), mais uma
// terceira quando a aba Plano do ContextPanel estava aberta. `taskPlansOf`
// memoiza por identidade do array: o primeiro que chegar no frame calcula, os
// outros consomem. Estes testes fixam esse contrato — sem eles a dedup volta a
// ser desfeita em silêncio na próxima refatoração.
import { describe, expect, it, vi } from "vitest"
import type { ChatItem } from "@/store/chat"
import { taskPlansOf, deriveTasks } from "./tasks"

function create(id: string, subject: string): ChatItem {
  return {
    kind: "tool",
    id,
    name: "TaskCreate",
    input: { subject },
  } as ChatItem
}

function fio(texto: string): ChatItem[] {
  return [
    { kind: "user", id: "u1", text: "faça" } as ChatItem,
    create("c1", "primeira"),
    create("c2", "segunda"),
    { kind: "text", id: "t1", text: texto } as ChatItem,
  ]
}

describe("taskPlansOf — uma derivação por fio", () => {
  it("dois consumidores do MESMO array recebem o MESMO objeto", () => {
    const items = fio("oi")
    const pai = taskPlansOf(items)
    const filho = taskPlansOf(items)
    expect(filho).toBe(pai)
    expect(filho.plans).toBe(pai.plans)
  })

  it("varre o fio uma vez só, mesmo com três consumidores no frame", () => {
    const items = fio("oi")
    const espiao = vi.spyOn(Array.prototype, "findLast")
    try {
      taskPlansOf(items)
      taskPlansOf(items)
      deriveTasks(items)
      // o findLast do turno corrente mora dentro do taskPlansOf: 3 chamadas,
      // 1 varredura.
      expect(espiao).toHaveBeenCalledTimes(1)
    } finally {
      espiao.mockRestore()
    }
  })

  it("token novo é fio novo: recalcula (o memo é por identidade, não por conteúdo)", () => {
    const antes = taskPlansOf(fio("oi"))
    const depois = taskPlansOf(fio("oiu"))
    expect(depois).not.toBe(antes)
    expect(depois.plans.at(-1)?.tasks.map((t) => t.title)).toEqual(
      antes.plans.at(-1)?.tasks.map((t) => t.title),
    )
  })
})

describe("taskPlansOf — o plano vivo é o mesmo que os dois lados calculavam", () => {
  it("plano do turno corrente ainda em aberto é o vivo", () => {
    const view = taskPlansOf(fio("trabalhando"))
    expect(view.latestUserId).toBe("u1")
    expect(view.live).toBe(view.plans.at(-1))
    expect(view.live?.anchorId).toBe("c1")
  })

  it("plano fechado por resultado terminal deixa de ser vivo", () => {
    const view = taskPlansOf([
      { kind: "user", id: "u1", text: "faça" } as ChatItem,
      create("c1", "primeira"),
      { kind: "result", id: "r1", ok: true } as ChatItem,
    ])
    expect(view.plans).toHaveLength(1)
    expect(view.live).toBeNull()
  })

  it("plano de turno ANTERIOR não vaza como vivo do turno novo", () => {
    const view = taskPlansOf([
      { kind: "user", id: "u1", text: "faça" } as ChatItem,
      create("c1", "primeira"),
      { kind: "user", id: "u2", text: "outra coisa" } as ChatItem,
      { kind: "text", id: "t1", text: "pensando" } as ChatItem,
    ])
    expect(view.latestUserId).toBe("u2")
    expect(view.plans.at(-1)?.turnId).toBe("u1")
    expect(view.live).toBeNull()
  })
})
