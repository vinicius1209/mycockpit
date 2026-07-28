// Custo da sessão (helper puro): soma dos turnos com `result`, colapsando os
// results parciais consecutivos da mesma invocação. Fonte única do strip de
// custo (que agora vive na barra de topo). Puro → sem mocks de store.
import { describe, expect, it } from "vitest"
import { sessionCost, type ChatItem } from "@/store/chat"

function result(
  id: string,
  costUsd: number,
  costSource: "reported" | "estimated" | "unknown" = "reported",
): ChatItem {
  return { kind: "result", id, ok: true, costUsd, costSource }
}

const user: ChatItem = { kind: "user", id: "u1", text: "roda" }
const text: ChatItem = { kind: "text", id: "t1", text: "feito" }

describe("sessionCost — custo acumulado da sessão", () => {
  it("conversa sem result: total 0, 0 turnos", () => {
    const c = sessionCost([user, text])
    expect(c).toEqual({ total: 0, estimated: false, turns: 0 })
  })

  it("soma o custo de cada turno com result", () => {
    const c = sessionCost([user, result("r1", 12.5), user, result("r2", 8.25)])
    expect(c.total).toBeCloseTo(20.75)
    expect(c.turns).toBe(2)
    expect(c.estimated).toBe(false)
  })

  it("results consecutivos (parciais da mesma invocação) contam só o último", () => {
    // 3 parciais + 1 final: só o final (31) vale, não a soma inflada.
    const c = sessionCost([
      result("p1", 10),
      result("p2", 20),
      result("p3", 25),
      result("p4", 31),
    ])
    expect(c.total).toBe(31)
    expect(c.turns).toBe(1)
  })

  it("qualquer turno estimado/desconhecido marca a sessão como estimada", () => {
    const c = sessionCost([
      result("r1", 5, "reported"),
      user,
      result("r2", 3, "estimated"),
    ])
    expect(c.estimated).toBe(true)
    expect(c.turns).toBe(2)
  })
})
