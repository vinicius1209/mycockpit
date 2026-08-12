// Teste-GÊMEO do Rust (`matriz_usage_window_por_agent` em adapters.rs) —
// mesma disciplina das matrizes de anexo/slash/canais/compactação/usage.
// Lá é a verdade auditada por versão (§7.1: claude 2.1.220 statusline, codex
// 0.146 app-server RPC, agy 1.1.12 só /credits); aqui é o espelho que a
// pill/popover/Configurações do medidor consultam. Mexeu aqui, mexa lá.

import { describe, expect, it } from "vitest"
import { AGENTS, agentDef, usageWindowAgents } from "./agents"

/** A matriz, escrita UMA vez. O teste Rust repete estes mesmos valores
 *  (statusline ↔ ClaudeStatusline, rpc ↔ CodexAppServer). */
const MATRIZ: Record<string, "statusline" | "rpc" | null> = {
  // claude 2.1.220: rate_limits no stdin da statusline a cada turno (payload
  // real capturado 12/08/2026).
  "claude-code": "statusline",
  // codex 0.146: account/rateLimits/read via app-server read-only (provado
  // na mão 12/08/2026).
  codex: "rpc",
  // agy 1.1.12: só /credits (saldo de créditos, sem % de janela nem reset,
  // verificado 12/08/2026) — saldo não é janela de uso.
  agy: null,
}

describe("janela de uso por agent (espelho do registry Rust)", () => {
  for (const [id, esperado] of Object.entries(MATRIZ)) {
    it(`${id}: usageWindow=${esperado}`, () => {
      expect(agentDef(id)?.usageWindow).toBe(esperado)
    })
  }

  it("agent desconhecido não promete nada (fail-closed)", () => {
    expect(agentDef("gemini-inexistente")?.usageWindow).toBeUndefined()
  })

  it("motor não integrado nunca declara fonte de janela", () => {
    for (const a of AGENTS.filter((x) => !x.available)) {
      expect(a.usageWindow, `${a.id}: fonte declarada sem integração`).toBeNull()
    }
  })

  it("a lista de motores medíveis sai do registry, nunca de nome fixo", () => {
    expect(usageWindowAgents().map((a) => a.id)).toEqual([
      "claude-code",
      "codex",
    ])
  })
})
