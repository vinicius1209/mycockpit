// G1.3 (capability-registry-plan) — a liga default do "Disputar" deriva o
// complementar do REGISTRY (capability `disputes` em lib/agents), nunca de um
// par fixo de fornecedores. O teste prova a DERIVAÇÃO, não o par: com os dois
// disputantes de hoje o resultado coincide com o de sempre, e um motor novo
// com a capability entraria sem tocar neste código.

import { describe, expect, it } from "vitest"
import { defaultLeague } from "./fusion"
import { agentDef, LEAGUE_AGENTS } from "@/lib/agents"

describe("defaultLeague — complementar derivado do registry", () => {
  for (const def of LEAGUE_AGENTS) {
    it(`${def.id}: o complementar é OUTRO motor com capacidade de disputa`, () => {
      const league = defaultLeague({ agent: def.id, model: null, effort: null })
      expect(league.candidates).toHaveLength(2)
      expect(league.candidates[0].agent).toBe(def.id)
      const comp = league.candidates[1].agent
      expect(comp).not.toBe(def.id)
      expect(agentDef(comp)?.disputes, `complementar de ${def.id}`).toBe(true)
    })
  }

  it("com os disputantes de hoje, o par é o de sempre (claude↔codex)", () => {
    expect(
      defaultLeague({ agent: "claude-code", model: null, effort: null })
        .candidates[1].agent,
    ).toBe("codex")
    expect(
      defaultLeague({ agent: "codex", model: null, effort: null })
        .candidates[1].agent,
    ).toBe("claude-code")
  })

  it("preserva modelo/effort do agent efetivo, read-only e juiz sonnet", () => {
    const league = defaultLeague({
      agent: "claude-code",
      model: "opus",
      effort: "high",
    })
    expect(league.candidates[0]).toEqual({
      agent: "claude-code",
      model: "opus",
      effort: "high",
    })
    expect(league.candidates[1].model).toBeNull()
    expect(league.scope).toBe("read-only")
    expect(league.judgeModel).toBe("sonnet")
  })
})
