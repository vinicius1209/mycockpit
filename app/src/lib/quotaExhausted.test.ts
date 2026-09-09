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

  // Regressão de 09/09/2026: o auto-resume retomou, o turno rodou inteiro e
  // terminou bem, e a faixa seguiu dizendo "sem cota para o próximo turno". O
  // poll da janela é de 15 min e o snapshot vale 30, então o "100%" lido ANTES
  // do turno continuava de pé DEPOIS dele. O app tinha a prova na mão.
  it("turno concluído depois da leitura desmente o 100% dela", () => {
    const snap = makeSnap("claude-code", 100, (AGORA + 3600 * 1000) / 1000)
    const passou = AGORA + 60_000
    const status = checkAgentQuota(
      "claude-code",
      {},
      snap,
      passou + 1_000,
      passou,
    )
    expect(status).toEqual({ exhausted: false, resetHint: null })
  })

  it("turno ANTERIOR à leitura não desmente nada", () => {
    // A leitura é mais nova que a prova: quem fala do agora é ela.
    const snap = makeSnap("claude-code", 100, (AGORA + 3600 * 1000) / 1000)
    const status = checkAgentQuota("claude-code", {}, snap, AGORA, AGORA - 60_000)
    expect(status.exhausted).toBe(true)
  })

  it("a contraprova não apaga o limite que o próprio CLI anunciou", () => {
    // `limitedAgents` é o `limit_reached` do CLI e tem cura própria (o
    // `result.ok` em handleEvent). Deixar a contraprova mexer aqui seria dar
    // duas curas ao mesmo sinal, e uma delas por caminho torto.
    const status = checkAgentQuota(
      "codex",
      { codex: "em 4d 15h" },
      null,
      AGORA,
      AGORA + 60_000,
    )
    expect(status.exhausted).toBe(true)
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

describe("a contraprova alcança os destinos de revezamento", () => {
  it("destino com leitura velha de 100% volta a ser oferecível depois de um turno dele", () => {
    // Sem isto, o motor que voltou continuaria fora da faixa de continuidade
    // pelo resto da validade do snapshot, e a escolha oferecida seria menor do
    // que a real.
    const snap = makeSnap("codex", 100, (AGORA + 3600 * 1000) / 1000)
    const entrada = {
      currentAgent: "claude-code",
      detected: { codex: makeProbe(true) },
      byAgentSnapshots: { codex: snap },
      now: AGORA + 60_000,
    }
    expect(
      eligibleHandoffTargets(entrada).map((o) => o.id),
    ).not.toContain("codex")
    expect(
      eligibleHandoffTargets({
        ...entrada,
        lastSuccessByAgent: { codex: AGORA + 30_000 },
      }).map((o) => o.id),
    ).toContain("codex")
  })
})
