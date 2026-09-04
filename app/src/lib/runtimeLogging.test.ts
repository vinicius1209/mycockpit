import { describe, expect, it } from "vitest"
import { formatRuntimeLog } from "./runtimeLogging"

describe("registro de falhas do frontend", () => {
  it("preserva mensagem e stack de um Error", () => {
    const error = new Error("render interrompido")
    error.stack = "Error: render interrompido\n  at MainTabs"

    expect(formatRuntimeLog(["[window.error]", error])).toContain(
      "Error: render interrompido\n  at MainTabs",
    )
  })

  it("não quebra ao receber valor circular do console", () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(formatRuntimeLog(["falha", circular])).toBe(
      "falha [object Object]",
    )
  })
})
