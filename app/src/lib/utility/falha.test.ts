import { describe, expect, it } from "vitest"
import { mensagemDaFalhaUtilitaria } from "./falha"

describe("motivo da falha da inferência utilitária", () => {
  it("estouro de prazo diz que foi tempo, não 'falha' genérica", () => {
    // É o que o gateway lança quando o helper não responde (generateUtilityText).
    expect(mensagemDaFalhaUtilitaria(new Error("deadline_exceeded"), "Falha ao sugerir a mensagem")).toBe(
      "O modelo auxiliar não respondeu a tempo.",
    )
  })

  it("login e limite viram instrução acionável", () => {
    expect(mensagemDaFalhaUtilitaria(new Error("auth_required"), "x")).toContain("login")
    expect(mensagemDaFalhaUtilitaria(new Error("rate_limited"), "x")).toContain("limite de uso")
  })

  it("erro desconhecido cai no padrão, e texto de backend em string passa como está", () => {
    expect(mensagemDaFalhaUtilitaria(new Error("algo_novo"), "Falha ao sugerir a mensagem")).toBe(
      "Falha ao sugerir a mensagem",
    )
    expect(mensagemDaFalhaUtilitaria("git não encontrado", "x")).toBe("git não encontrado")
    expect(mensagemDaFalhaUtilitaria(undefined, "padrão")).toBe("padrão")
  })

  it("nenhum motivo usa travessão", () => {
    for (const codigo of ["deadline_exceeded", "auth_required", "rate_limited", "spawn_failed", "process_failed"]) {
      expect(mensagemDaFalhaUtilitaria(new Error(codigo), "x")).not.toContain("—")
    }
  })
})
