import { describe, expect, it } from "vitest"
import { alternativeAgentsFor, checkAgentQuota } from "./quotaExhausted"
import type { AgentProbe } from "./detect"
import type { UsageSnapshot } from "./usageWindow"

const AGORA = 1_786_543_200_000

function makeProbe(installed: boolean): AgentProbe {
  return {
    installed,
    version: "1.0.0",
    auth: "ok",
    detail: null,
    latest: null,
    checkedAt: AGORA,
  }
}

function makeSnap(agent: string, usedPct: number, resetsAtSecs: number | null): UsageSnapshot {
  return {
    agent,
    source: "statusline",
    planType: "pro",
    fetchedAt: AGORA,
    windows: [
      {
        id: "7d",
        label: "7 dias",
        windowMinutes: 7 * 24 * 60,
        usedPercent: usedPct,
        resetsAt: resetsAtSecs,
      },
    ],
  }
}

describe("checkAgentQuota", () => {
  it("detecta limite quando o agente está em limitedAgents", () => {
    const status = checkAgentQuota("codex", { codex: "em 4d 15h" }, null, AGORA)
    expect(status.exhausted).toBe(true)
    expect(status.resetHint).toBe("em 4d 15h")
  })

  it("detecta limite quando snapshot da janela de uso atinge 100%", () => {
    const snap = makeSnap("codex", 100, (AGORA + 3600 * 1000) / 1000)
    const status = checkAgentQuota("codex", {}, snap, AGORA)
    expect(status.exhausted).toBe(true)
    expect(status.resetHint).toContain("reseta em")
  })

  it("retorna false quando o uso está abaixo de 100%", () => {
    const snap = makeSnap("claude-code", 25, null)
    const status = checkAgentQuota("claude-code", {}, snap, AGORA)
    expect(status.exhausted).toBe(false)
    expect(status.resetHint).toBeNull()
  })

  it("ignora snapshot de 100% que já ficou velho", () => {
    const snap = makeSnap("codex", 100, (AGORA + 3600 * 1000) / 1000)
    const status = checkAgentQuota("codex", {}, snap, AGORA + 31 * 60_000)
    expect(status).toEqual({ exhausted: false, resetHint: null })
  })
})

describe("alternativeAgentsFor", () => {
  it("filtra o agente atual, agentes ausentes e agentes já limitados", () => {
    const codexSnap = makeSnap("codex", 100, null)
    const claudeSnap = makeSnap("claude-code", 10, null)
    const agySnap = makeSnap("agy", 20, null)

    const opcoes = alternativeAgentsFor(
      "codex",
      {
        "claude-code": makeProbe(true),
        agy: makeProbe(true),
        opencode: makeProbe(false),
      },
      {},
      { codex: codexSnap, "claude-code": claudeSnap, agy: agySnap },
      AGORA,
    )

    const ids = opcoes.map((o) => o.id)
    expect(ids).toContain("claude-code")
    expect(ids).toContain("agy")
    expect(ids).not.toContain("codex")
    expect(ids).not.toContain("opencode")
  })

  it("não oferece alternativa que também esteja com cota esgotada", () => {
    const opcoes = alternativeAgentsFor(
      "codex",
      {
        "claude-code": makeProbe(true),
        agy: makeProbe(true),
      },
      { "claude-code": "em 2h" },
      {},
      AGORA,
    )
    const ids = opcoes.map((o) => o.id)
    expect(ids).not.toContain("claude-code")
    expect(ids).toContain("agy")
  })
})
