import { beforeEach, describe, expect, it } from "vitest"
import {
  limparCausasDoCorte,
  marcarCausaDoCorte,
  rotuloDoCorte,
  tomarCausaDoCorte,
} from "@/lib/corte"

beforeEach(() => {
  limparCausasDoCorte()
})

describe("causa do corte: o gesto carimba, o cancelled consome", () => {
  it("a causa carimbada é entregue uma vez só", () => {
    marcarCausaDoCorte("e78edeef", "correcao")
    expect(tomarCausaDoCorte("e78edeef")).toBe("correcao")
    expect(tomarCausaDoCorte("e78edeef")).toBeUndefined()
  })

  it("carimbo de uma conversa não vaza para outra", () => {
    marcarCausaDoCorte("e78edeef", "parada")
    expect(tomarCausaDoCorte("7e076d02")).toBeUndefined()
    expect(tomarCausaDoCorte("e78edeef")).toBe("parada")
  })

  it("o gesto mais recente vence", () => {
    marcarCausaDoCorte("e78edeef", "correcao")
    marcarCausaDoCorte("e78edeef", "parada")
    expect(tomarCausaDoCorte("e78edeef")).toBe("parada")
  })
})

describe("rotuloDoCorte", () => {
  it("nomeia quem cortou, no pretérito", () => {
    expect(rotuloDoCorte("correcao")).toBe("você interrompeu para corrigir")
    expect(rotuloDoCorte("parada")).toBe("você interrompeu o turno")
    expect(rotuloDoCorte("disputa")).toBe("você interrompeu a disputa")
  })

  it("sem causa não inventa autor", () => {
    expect(rotuloDoCorte(undefined)).toBe("interrompido")
  })
})
