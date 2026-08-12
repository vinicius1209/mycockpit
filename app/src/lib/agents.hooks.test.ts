// Teste-GÊMEO do Rust (`matriz_de_hooks_por_agent` em adapters.rs) — mesma
// disciplina das matrizes de anexo/slash/canais/compactação/usage/janela.
// Lá é a verdade auditada por versão (hooks-plan §1: claude 2.1.220
// settings.json chave hooks, codex 0.146 hooks.json dedicado com trust por
// hook, agy 1.1.12 grupos nomeados com Stop só ≥1.1.10); aqui é o espelho que
// Configurações e as superfícies de sessão externa consultam. Mexeu aqui,
// mexa lá.

import { describe, expect, it } from "vitest"
import { AGENTS, agentDef, hooksAgents } from "./agents"

/** A matriz, escrita UMA vez. O teste Rust repete estes mesmos valores
 *  (claude-settings ↔ ClaudeSettings, codex-hooks-json ↔ CodexHooksJson,
 *  agy-config-hooks ↔ AgyConfigHooks). */
const MATRIZ: Record<
  string,
  "claude-settings" | "codex-hooks-json" | "agy-config-hooks" | null
> = {
  // claude 2.1.220: hooks maduros — payloads reais capturados 12/08/2026
  // (fixtures em hook_sessions.rs).
  "claude-code": "claude-settings",
  // codex 0.146: `codex features list` → hooks stable/true; schema idêntico
  // ao do claude, vivo nesta máquina (Xirp/Orca, 12/08/2026).
  codex: "codex-hooks-json",
  // agy 1.1.12: doc embarcada + grupo "orca-status" vivo (12/08/2026); o
  // gate de versão ≥1.1.10 fica no instalador Rust.
  agy: "agy-config-hooks",
}

describe("hooks de ciclo de vida por agent (espelho do registry Rust)", () => {
  for (const [id, dialeto] of Object.entries(MATRIZ)) {
    it(`${id}: hookDialect=${dialeto}`, () => {
      expect(agentDef(id)?.hooksStatus).toBe(dialeto != null)
      expect(agentDef(id)?.hookDialect).toBe(dialeto)
      // H2: os três motores auditados têm permissão síncrona (claude/codex
      // PermissionRequest; agy PreToolUse.decision).
      expect(agentDef(id)?.hooksPermission).toBe(dialeto != null)
    })
  }

  it("agent desconhecido não promete nada (fail-closed)", () => {
    expect(agentDef("gemini-inexistente")?.hooksStatus).toBeUndefined()
  })

  it("motor não integrado nunca declara hooks", () => {
    for (const a of AGENTS.filter((x) => !x.available)) {
      expect(a.hooksStatus, `${a.id}: hooks declarados sem integração`).toBe(
        false,
      )
      expect(a.hookDialect).toBeNull()
    }
  })

  it("hooksStatus e hookDialect andam juntos em TODO agent (coerência)", () => {
    // declarar hooks sem dialeto prometeria uma instalação que o Rust não
    // sabe fazer — mesma assertiva do loop do teste Rust.
    for (const a of AGENTS) {
      expect(a.hooksStatus, `${a.id}: status ≠ dialeto`).toBe(
        a.hookDialect != null,
      )
      // permissão exige status (mesmo script/instalador) — loop, não cópia.
      if (a.hooksPermission) {
        expect(a.hooksStatus, `${a.id}: permissão sem status`).toBe(true)
      }
    }
  })

  it("a lista de motores com hooks sai do registry, nunca de nome fixo", () => {
    expect(hooksAgents().map((a) => a.id)).toEqual([
      "claude-code",
      "codex",
      "agy",
    ])
  })
})
