// Testes de buildRecoveryChoice — re-hospedados do ex-office/ui/ui.test.ts
// (R2 do office-removal-plan): a lib segue viva, consumida pelo card de
// recovery do Trabalho (components/mission/MissionTimeline). Asserções
// idênticas às originais; só o import mudou (office/ui/recovery.ts era
// re-export puro desta lib).

import { describe, expect, it } from "vitest"

import { buildRecoveryChoice } from "@/lib/recoveryChoice"

describe("buildRecoveryChoice — escolha do card de recuperação", () => {
  it("'default' vira null (agent decide) — modelo e effort", () => {
    expect(buildRecoveryChoice("codex", "default")).toEqual({
      agent: "codex",
      model: null,
      effort: null,
    })
  })

  it("modelo/effort reais são preservados", () => {
    expect(buildRecoveryChoice("claude-code", "opus", "high")).toEqual({
      agent: "claude-code",
      model: "opus",
      effort: "high",
    })
  })

  it("modelo null direto também vira null", () => {
    expect(buildRecoveryChoice("agy", null)).toEqual({
      agent: "agy",
      model: null,
      effort: null,
    })
  })
})
