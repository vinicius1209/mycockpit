import { describe, expect, it } from "vitest"
import {
  METER_DANGER_PCT,
  METER_FILL,
  METER_TEXT,
  METER_WARN_PCT,
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
