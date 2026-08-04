// S1.1 — o divisor "novas mensagens" marca a fronteira do que chegou sem você
// ver. A régua é derivada dos items (replay-safe): o não-visto começa DEPOIS da
// sua última mensagem — a resposta do turno que terminou longe dos seus olhos.
import { describe, expect, it } from "vitest"
import { unseenBoundary } from "./unseen"

const you = (id: string) => ({ id, kind: "user" })
const bot = (id: string, kind = "text") => ({ id, kind })

describe("unseenBoundary", () => {
  it("fronteira = primeiro item depois da SUA última mensagem", () => {
    expect(
      unseenBoundary([you("u1"), bot("t1"), you("u2"), bot("t2"), bot("r2")]),
    ).toBe("t2")
  })

  it("turno terminou em erro: a fronteira também vale (o erro é o não-visto)", () => {
    expect(unseenBoundary([you("u1"), bot("e1", "error")])).toBe("e1")
  })

  it("sua mensagem é a última (turno sem resposta) → sem fronteira", () => {
    expect(unseenBoundary([bot("t1"), you("u1")])).toBeNull()
  })

  it("fio sem mensagem sua (automação): tudo é novo → primeiro item", () => {
    expect(unseenBoundary([bot("t1"), bot("t2")])).toBe("t1")
  })

  it("fio vazio → sem fronteira", () => {
    expect(unseenBoundary([])).toBeNull()
  })
})
