// O rótulo da tray responde pelo que o NÚMERO conta.
//
// O selo somava disputas + pedidos bloqueantes e o subtítulo era a string fixa
// "Revisar resultado da disputa": um pedido de permissão chegava anunciado como
// disputa. Aqui a regra vira função pura, com o caso comum (só pedidos) em
// primeiro lugar, porque era ele que estava errado.
import { describe, expect, it } from "vitest"
import { decisionSubtitle } from "@/lib/tray"

describe("subtítulo do cartão de decisão da tray", () => {
  it("só pedidos bloqueantes: NÃO fala em disputa", () => {
    expect(decisionSubtitle(1, 1)).toBe("Um pedido parou o turno")
    expect(decisionSubtitle(3, 3)).toBe("Pedidos pararam os turnos")
    expect(decisionSubtitle(1, 1)).not.toMatch(/disputa/i)
  })

  it("só disputas: mantém o texto de antes, que ali estava certo", () => {
    expect(decisionSubtitle(1, 0)).toBe("Revisar resultado da disputa")
    expect(decisionSubtitle(2, 0)).toBe("Revisar resultados das disputas")
  })

  it("os dois juntos: não escolhe um e esconde o outro", () => {
    const s = decisionSubtitle(3, 1)
    expect(s).toBe("Pedidos e disputas esperando")
  })

  it("nunca promete disputa quando não há nenhuma", () => {
    // A regressão exata do build 208: 20 permissões de Bash, zero disputas.
    for (const n of [1, 2, 5, 20]) {
      expect(decisionSubtitle(n, n)).not.toMatch(/disputa/i)
    }
  })
})
