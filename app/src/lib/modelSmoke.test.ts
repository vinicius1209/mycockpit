// Réguas do consumidor da fumaça (M2). Os desfechos aqui são os que o Rust
// produziu de VERDADE nesta máquina em 14/08/2026, rodando a fumaça contra um
// slug válido e um inválido de cada motor (ADR-016).

import { describe, expect, it } from "vitest"
import {
  canSmokeTest,
  isVerdict,
  outcomeNote,
  verdictFor,
  type SmokeResult,
} from "./modelSmoke"

function res(over: Partial<SmokeResult>): SmokeResult {
  return {
    agent: "codex",
    model: "gpt-5.6-luna",
    outcome: "ok",
    detail: "turno concluído",
    cliVersion: "0.147.0",
    contextWindow: null,
    catalogContext: null,
    canonicalModel: null,
    checkedAt: 1_786_000_000_000,
    ...over,
  }
}

describe("desfecho da fumaça de um token", () => {
  it("só o 'não sei' deixa de ser veredito", () => {
    for (const o of ["ok", "auth-rejected", "unknown-slug", "context-mismatch"] as const) {
      expect(isVerdict(o), `${o} decide algo sobre o slug`).toBe(true)
    }
    expect(isVerdict("unreachable")).toBe(false)
  })

  it("a recusa chega ao humano COM o motivo, nunca como 'falhou'", () => {
    // O plano: "o Codex rejeitou este slug com a sua autenticação" vale mais
    // que aprovar/dispensar às cegas.
    expect(outcomeNote(res({ outcome: "auth-rejected" }))).toContain("autenticação")
    expect(outcomeNote(res({ outcome: "unknown-slug" }))).toContain("não reconhece")
    expect(outcomeNote(res({ outcome: "unreachable" }))).toContain(
      "nada foi promovido nem rebaixado",
    )
  })

  it("o mismatch de contexto mostra os dois números quando os tem", () => {
    const nota = outcomeNote(
      res({ outcome: "context-mismatch", contextWindow: 272_000, catalogContext: 1_000_000 }),
    )
    expect(nota).toContain("272000")
    expect(nota).toContain("1000000")
    // Sem os números, a frase não inventa nenhum.
    expect(outcomeNote(res({ outcome: "context-mismatch" }))).not.toMatch(/\d/)
  })

  it("o veredito de um par (motor, slug) ignora tentativa que não soube dizer", () => {
    const historico = [
      res({ agent: "codex", model: "gpt-5.4", outcome: "unknown-slug" }),
      res({ agent: "agy", model: "gemini-3.7-flash-low", outcome: "unreachable" }),
    ]
    expect(verdictFor(historico, "codex", "gpt-5.4")?.outcome).toBe("unknown-slug")
    // "não deu para saber" não vira "não funciona": some do veredito.
    expect(verdictFor(historico, "agy", "gemini-3.7-flash-low")).toBeNull()
    // Nunca testado também é null (não saber nunca é condenar).
    expect(verdictFor(historico, "codex", "gpt-5.6-sol")).toBeNull()
  })

  it("quem pode ser testado sai do registry, nunca de nome escrito à mão", () => {
    expect(canSmokeTest("claude-code")).toBe(true)
    expect(canSmokeTest("codex")).toBe(true)
    expect(canSmokeTest("agy")).toBe(true)
    expect(canSmokeTest("motor-que-nao-existe")).toBe(false)
  })
})
