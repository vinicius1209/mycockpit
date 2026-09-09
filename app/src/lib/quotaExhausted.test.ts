import { describe, expect, it } from "vitest"
import { checkAgentQuota, eligibleHandoffTargets } from "./quotaExhausted"
import type { Attachment } from "./attachments"
import type { AgentProbe } from "./detect"
import type { Destination } from "./types"
import type { UsageSnapshot } from "./usageWindow"

const AGORA = 1_786_543_200_000

function makeProbe(
  installed: boolean,
  auth: AgentProbe["auth"] = "ok",
): AgentProbe {
  return {
    installed,
    version: "1.0.0",
    auth,
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

describe("eligibleHandoffTargets", () => {
  it("oferece Claude Code, Antigravity e OpenCode ao sair do Codex", () => {
    const options = eligibleHandoffTargets({
      currentAgent: "codex",
      detected: {
        "claude-code": makeProbe(true),
        agy: makeProbe(true),
        opencode: makeProbe(true),
      },
      now: AGORA,
    })

    expect(options.map((option) => option.id)).toEqual([
      "claude-code",
      "agy",
      "opencode",
    ])
  })

  it("filtra o agente atual, agentes ausentes e agentes já limitados", () => {
    const codexSnap = makeSnap("codex", 100, null)
    const claudeSnap = makeSnap("claude-code", 10, null)
    const agySnap = makeSnap("agy", 20, null)

    const opcoes = eligibleHandoffTargets({
      currentAgent: "codex",
      detected: {
        "claude-code": makeProbe(true),
        agy: makeProbe(true),
        opencode: makeProbe(false),
      },
      byAgentSnapshots: {
        codex: codexSnap,
        "claude-code": claudeSnap,
        agy: agySnap,
      },
      now: AGORA,
    })

    const ids = opcoes.map((o) => o.id)
    expect(ids).toContain("claude-code")
    expect(ids).toContain("agy")
    expect(ids).not.toContain("codex")
    expect(ids).not.toContain("opencode")
  })

  it("não oferece alternativa que também esteja com cota esgotada", () => {
    const opcoes = eligibleHandoffTargets({
      currentAgent: "codex",
      detected: {
        "claude-code": makeProbe(true),
        agy: makeProbe(true),
      },
      limitedAgents: { "claude-code": "em 2h" },
      now: AGORA,
    })
    const ids = opcoes.map((o) => o.id)
    expect(ids).not.toContain("claude-code")
    expect(ids).toContain("agy")
  })

  it("exclui CLI instalada sem login e conserva detecção desconhecida", () => {
    const options = eligibleHandoffTargets({
      currentAgent: "codex",
      detected: {
        "claude-code": makeProbe(true, "missing"),
        agy: makeProbe(true),
      },
      now: AGORA,
    })
    const ids = options.map((option) => option.id)
    expect(ids).not.toContain("claude-code")
    expect(ids).toContain("agy")
    expect(ids).toContain("opencode")
  })

  it("nunca oferece destino que não seja agente", () => {
    const directModel: Destination = {
      id: "claude-code",
      label: "Modelo direto",
      kind: "model",
      available: true,
    }
    expect(
      eligibleHandoffTargets({
        currentAgent: "codex",
        destinations: [directModel],
        now: AGORA,
      }),
    ).toEqual([])
  })

  it("exclui destino incompatível com o anexo do pedido interrompido", () => {
    const pdf: Attachment = {
      path: "attachments/c1/manual.pdf",
      name: "manual.pdf",
      kind: "pdf",
      mime: "application/pdf",
      bytes: 1200,
    }
    const options = eligibleHandoffTargets({
      currentAgent: "codex",
      detected: {
        "claude-code": makeProbe(true),
        agy: makeProbe(true),
        opencode: makeProbe(true),
      },
      attachments: [pdf],
      now: AGORA,
    })
    expect(options.map((option) => option.id)).toEqual([
      "claude-code",
      "agy",
    ])
  })
})
