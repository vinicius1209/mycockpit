import { describe, expect, it } from "vitest"
import { isLinearInFlight } from "@/lib/traySnapshot"

describe("atividade linear publicada no instrumento", () => {
  it("conta running e finalizing como turno em voo", () => {
    expect(isLinearInFlight({ running: true, finalizing: false })).toBe(true)
    expect(isLinearInFlight({ running: false, finalizing: true })).toBe(true)
    expect(isLinearInFlight({ running: false, finalizing: false })).toBe(false)
  })
})
