import { describe, expect, it } from "vitest"
import {
  METER_DANGER_PCT,
  METER_FILL,
  METER_TEXT,
  METER_WARN_PCT,
  absoluteTone,
  meterIsLoud,
  meterTone,
} from "./meter"

describe("meterTone", () => {
  it("medidor saudável é cinza, nunca brass nem verde", () => {
    expect(meterTone(0)).toBe("ok")
    expect(meterTone(59.9)).toBe("ok")
    expect(METER_TEXT.ok).toBe("text-muted-foreground")
    expect(METER_FILL.ok).not.toContain("brass")
    expect(METER_FILL.ok).not.toContain("success")
  })

  it("a partir de 60% vira âmbar (aquecendo)", () => {
    expect(meterTone(METER_WARN_PCT)).toBe("warn")
    expect(meterTone(79.9)).toBe("warn")
    expect(METER_TEXT.warn).toBe("text-st-warning")
  })

  it("a partir de 80% vira vermelho (perto do teto)", () => {
    expect(meterTone(METER_DANGER_PCT)).toBe("danger")
    expect(meterTone(100)).toBe("danger")
    expect(METER_TEXT.danger).toBe("text-st-error")
  })

  it("o medidor só deixa de ser mudo no vermelho", () => {
    expect(meterIsLoud(59)).toBe(false)
    expect(meterIsLoud(70)).toBe(false)
    expect(meterIsLoud(80)).toBe(true)
    expect(meterIsLoud(100)).toBe(true)
  })

  it("percentual fora da faixa não quebra a decisão", () => {
    expect(meterTone(-10)).toBe("ok")
    expect(meterTone(9999)).toBe("danger")
  })
})

describe("absoluteTone (valor sem teto natural, ex. US$ da sessão)", () => {
  it("sem teto definido pelo usuário, gasto nenhum ganha tinta", () => {
    expect(absoluteTone(0, null)).toBe("ok")
    expect(absoluteTone(0.42, null)).toBe("ok")
    expect(absoluteTone(120, null)).toBe("ok")
    expect(absoluteTone(9999, undefined)).toBe("ok")
  })

  it("teto inválido é o mesmo que não ter teto (nunca inventa limiar)", () => {
    expect(absoluteTone(50, 0)).toBe("ok")
    expect(absoluteTone(50, -5)).toBe("ok")
    expect(absoluteTone(50, Number.NaN)).toBe("ok")
    expect(absoluteTone(50, Number.POSITIVE_INFINITY)).toBe("ok")
  })

  it("com teto do usuário, o absoluto cai na régua única de medidor", () => {
    // teto US$ 10: 59% cinza, 60% âmbar, 80% vermelho — a mesma régua do §2.
    expect(absoluteTone(5.9, 10)).toBe("ok")
    expect(absoluteTone(6, 10)).toBe("warn")
    expect(absoluteTone(7.99, 10)).toBe("warn")
    expect(absoluteTone(8, 10)).toBe("danger")
    expect(absoluteTone(23, 10)).toBe("danger")
  })

  it("valor ausente ou negativo não pinta nada", () => {
    expect(absoluteTone(0, 10)).toBe("ok")
    expect(absoluteTone(-1, 10)).toBe("ok")
    expect(absoluteTone(Number.NaN, 10)).toBe("ok")
  })
})
