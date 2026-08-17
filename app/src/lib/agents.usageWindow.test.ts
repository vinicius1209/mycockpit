// Teste-GÊMEO do Rust (`matriz_usage_window_por_agent` em adapters.rs) —
// mesma disciplina das matrizes de anexo/slash/canais/compactação/usage.
// Lá é a verdade auditada por versão (§7.1: claude 2.1.220 statusline, codex
// 0.146 app-server RPC, agy 1.1.13 print mode do `/usage`); aqui é o espelho
// que a pill/popover/Configurações do medidor consultam. Mexeu aqui, mexa lá.

import { describe, expect, it } from "vitest"
import { AGENTS, agentDef } from "./agents"
import { usageWindowAgents } from "./agentRoster"

/** A matriz, escrita UMA vez. O teste Rust repete estes mesmos valores
 *  (statusline ↔ ClaudeStatusline, rpc ↔ CodexAppServer, oauth ↔
 *  ClaudeOauth, print ↔ AgyPrintCommand). */
const MATRIZ: Record<string, "statusline" | "rpc" | "print" | null> = {
  // claude 2.1.220: rate_limits no stdin da statusline a cada turno (payload
  // real capturado 12/08/2026).
  "claude-code": "statusline",
  // codex 0.146: account/rateLimits/read via app-server read-only (provado
  // na mão 12/08/2026).
  codex: "rpc",
  // agy 1.1.13: era null porque a única fonte auditada era o /credits (saldo
  // absoluto, que não é janela percentual). O MOTIVO CAIU em 16/08/2026: o
  // `-p "/usage" --output-format json` devolve `command.data` com grupos ×
  // buckets, cada um com remaining_fraction, window e reset. E o payload
  // prova que a consulta é grátis (num_turns 0, usage zerado,
  // conversation_id vazio), então o poll cabe na cadência normal.
  agy: "print",
}

/** E quem o VIGIA pergunta. O claude diverge de propósito: a statusline é
 *  push e só existe em sessão interativa (em `-p` o script nunca roda,
 *  provado 12/08/2026), então o poll fala com a CONTA. No agy as duas colunas
 *  são a MESMA fonte: o print mode é a sonda, não há push a esperar. */
const MATRIZ_POLL: Record<string, "oauth" | "rpc" | "print" | null> = {
  "claude-code": "oauth",
  codex: "rpc",
  agy: "print",
}

describe("janela de uso por agent (espelho do registry Rust)", () => {
  for (const [id, esperado] of Object.entries(MATRIZ)) {
    it(`${id}: usageWindow=${esperado}`, () => {
      expect(agentDef(id)?.usageWindow).toBe(esperado)
    })
  }

  for (const [id, esperado] of Object.entries(MATRIZ_POLL)) {
    it(`${id}: usagePoll=${esperado}`, () => {
      expect(agentDef(id)?.usagePoll).toBe(esperado)
    })
  }

  it("agent desconhecido não promete nada (fail-closed)", () => {
    expect(agentDef("gemini-inexistente")?.usageWindow).toBeUndefined()
    expect(agentDef("gemini-inexistente")?.usagePoll).toBeUndefined()
  })

  it("motor não integrado nunca declara fonte de janela", () => {
    for (const a of AGENTS.filter((x) => !x.available)) {
      expect(a.usageWindow, `${a.id}: fonte declarada sem integração`).toBeNull()
      expect(a.usagePoll, `${a.id}: poll declarado sem integração`).toBeNull()
    }
  })

  it("perguntar exige ter medidor, e push nunca é dialeto de poll", () => {
    for (const a of AGENTS) {
      if (a.usagePoll != null) {
        expect(a.usageWindow, `${a.id}: poll de um medidor que não existe`).not.toBeNull()
      }
      expect(a.usagePoll, `${a.id}: statusline é push, não se pergunta`).not.toBe(
        "statusline",
      )
    }
  })

  it("a lista de motores medíveis sai do registry, nunca de nome fixo", () => {
    expect(usageWindowAgents().map((a) => a.id)).toEqual([
      "claude-code",
      "codex",
      "agy",
    ])
  })
})
