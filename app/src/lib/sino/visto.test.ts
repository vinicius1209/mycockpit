import { describe, expect, it } from "vitest"
import { conversaAMarcar } from "@/lib/sino/visto"

const naoLido = { convId: "c1", read: false }

describe("conversaAMarcar", () => {
  it("a conversa na tela, com a janela em foco, marca o que é dela", () => {
    expect(conversaAMarcar("c1", true, [naoLido])).toBe("c1")
  })

  it("janela sem foco não conta como visto: você está em outro app", () => {
    expect(conversaAMarcar("c1", false, [naoLido])).toBeNull()
  })

  it("sem conversa na tela (Agendado, Frota, planos de voo), nada vira visto", () => {
    expect(conversaAMarcar(null, true, [naoLido])).toBeNull()
  })

  it("aviso de outra conversa continua não visto", () => {
    expect(conversaAMarcar("c2", true, [naoLido])).toBeNull()
  })

  it("já tudo visto, não há o que marcar (e o store não é tocado)", () => {
    expect(conversaAMarcar("c1", true, [{ convId: "c1", read: true }])).toBeNull()
  })
})
