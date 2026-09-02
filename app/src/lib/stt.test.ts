import { describe, expect, it } from "vitest"
import { sttEventBelongsTo } from "./stt"

describe("identidade dos eventos de ditado", () => {
  it("aceita somente eventos da tentativa que abriu esta superfície", () => {
    expect(sttEventBelongsTo("tentativa-a", { attemptId: "tentativa-a" })).toBe(
      true,
    )
    expect(sttEventBelongsTo("tentativa-a", { attemptId: "tentativa-b" })).toBe(
      false,
    )
  })

  it("não aceita evento quando a superfície já descartou a tentativa", () => {
    expect(sttEventBelongsTo(null, { attemptId: "tentativa-antiga" })).toBe(
      false,
    )
  })
})
