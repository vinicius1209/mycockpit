// Testes do medidor de janela de uso (lado TS): política de poll do Orca
// copiada como REGRA, staleness honesta e agregação da pill. As fixtures são
// o ESPELHO exato do que o Rust emite a partir dos payloads REAIS capturados
// em 12/08/2026 (ADR-016: os valores 23/29/30%, resets e janelas vêm da
// statusline do claude 2.1.220 e do account/rateLimits/read do codex 0.146
// desta máquina — ver usage_window.rs).

import { beforeEach, describe, expect, it } from "vitest"
import type { AgentProbe } from "@/lib/detect"
import {
  POLL_FLOOR_MS,
  POLL_MS,
  STALE_MS,
  STALE_RATE_LIMITED_MS,
  USAGE_DANGER_PCT,
  USAGE_WARN_PCT,
  _resetUsagePollState,
  duePollAgents,
  fmtAge,
  fmtPct,
  fmtResetIn,
  markPollAttempt,
  nextPollDelayMs,
  parseFetchError,
  pillWindow,
  recordPollResult,
  snapshotUsable,
  usagePillLabel,
  usageTone,
  worstWindow,
  type UsageFailure,
  type UsageSnapshot,
} from "./usageWindow"
import { useUsage } from "@/store/usage"

/** Snapshot como o Rust emite pro payload REAL da statusline (claude). */
const SNAP_CLAUDE: UsageSnapshot = {
  agent: "claude-code",
  source: "statusline",
  windows: [
    { id: "5h", label: "5 h", usedPercent: 23, resetsAt: 1_786_557_000, windowMinutes: 300 },
    // o CLI manda float sujo — o pipeline preserva, a UI arredonda.
    { id: "7d", label: "7 dias", usedPercent: 28.999999999999996, resetsAt: 1_786_996_800, windowMinutes: 10_080 },
  ],
  planType: null,
  fetchedAt: 1_786_543_000_000,
}

/** Snapshot como o Rust emite pra resposta REAL do codex (só primary/7d). */
const SNAP_CODEX: UsageSnapshot = {
  agent: "codex",
  source: "rpc",
  windows: [
    { id: "7d", label: "7 dias", usedPercent: 30, resetsAt: 1_787_056_559, windowMinutes: 10_080 },
  ],
  planType: "plus",
  fetchedAt: 1_786_543_100_000,
}

const AGORA = 1_786_543_200_000 // ~3min depois do snapshot do claude

function probe(overrides: Partial<AgentProbe> = {}): AgentProbe {
  return {
    installed: true,
    version: "0.146.0",
    auth: "ok",
    detail: null,
    latest: null,
    checkedAt: AGORA,
    ...overrides,
  }
}

beforeEach(() => {
  _resetUsagePollState()
  useUsage.setState({ byAgent: {}, failures: {} })
})

describe("política de poll (regra do Orca)", () => {
  it("sucesso volta pra cadência cheia de 15min", () => {
    expect(nextPollDelayMs(0, null)).toBe(POLL_MS)
  })

  it("falha transiente re-tenta rápido com backoff exponencial (piso 30s)", () => {
    expect(nextPollDelayMs(1, "spawn")).toBe(POLL_FLOOR_MS) // 30s
    expect(nextPollDelayMs(2, "spawn")).toBe(POLL_FLOOR_MS * 2) // 1min
    expect(nextPollDelayMs(3, "timeout")).toBe(POLL_FLOOR_MS * 4) // 2min
  })

  it("backoff nunca passa da cadência cheia (expoente com cap 8)", () => {
    expect(nextPollDelayMs(9, "spawn")).toBe(POLL_MS)
    expect(nextPollDelayMs(100, "spawn")).toBe(POLL_MS) // streak não estoura
  })

  it("429 nunca acelera: falha rate-limited espera a cadência cheia", () => {
    expect(nextPollDelayMs(1, "rate-limited")).toBe(POLL_MS)
  })
})

describe("staleness honesta", () => {
  it("snapshot fresco é mostrável; passado o stale-drop de 30min, cai", () => {
    expect(snapshotUsable(SNAP_CLAUDE, undefined, AGORA)).toBe(true)
    const velho = SNAP_CLAUDE.fetchedAt + STALE_MS + 1
    expect(snapshotUsable(SNAP_CLAUDE, undefined, velho)).toBe(false)
  })

  it("com falha 429 o snapshot velho segura 24h (velho > 'Limited')", () => {
    const f: UsageFailure = { kind: "rate-limited", message: "429", since: AGORA, streak: 1 }
    const em23h = SNAP_CODEX.fetchedAt + 23 * 60 * 60_000
    expect(snapshotUsable(SNAP_CODEX, f, em23h)).toBe(true)
    const em25h = SNAP_CODEX.fetchedAt + STALE_RATE_LIMITED_MS + 1
    expect(snapshotUsable(SNAP_CODEX, f, em25h)).toBe(false)
  })
})

describe("agregação da pill", () => {
  it("mostra a janela MAIS queimada entre os providers vivos", () => {
    const worst = worstWindow(
      { "claude-code": SNAP_CLAUDE, codex: SNAP_CODEX },
      {},
      AGORA,
    )
    expect(worst?.agent).toBe("codex") // 30% > 29% > 23%
    expect(worst?.window.id).toBe("7d")
  })

  it("snapshot caído (stale) sai da agregação em vez de mentir", () => {
    const depois = SNAP_CLAUDE.fetchedAt + STALE_MS + 1
    const codexFresco = { ...SNAP_CODEX, fetchedAt: depois }
    const worst = worstWindow(
      { "claude-code": SNAP_CLAUDE, codex: codexFresco },
      {},
      depois,
    )
    expect(worst?.agent).toBe("codex")
    expect(
      worstWindow({ "claude-code": SNAP_CLAUDE }, {}, depois),
    ).toBeNull() // ninguém vivo = pill some, nunca inventa
  })
})

describe("seleção do provider da pill (conversa ativa)", () => {
  it("agent da conversa ativa com janela medida ganha do pior global", () => {
    const sel = pillWindow(
      "claude-code",
      { "claude-code": SNAP_CLAUDE, codex: SNAP_CODEX },
      {},
      AGORA,
    )
    // numa conversa Claude a pill mostra o Claude (29%), não os 30% do Codex
    expect(sel?.agent).toBe("claude-code")
    expect(sel?.window.id).toBe("7d") // a janela MAIS queimada DELE (29 > 23)
  })

  it("agent ativo sem medição cai pro pior global (que a pill nomeia)", () => {
    const sel = pillWindow("claude-code", { codex: SNAP_CODEX }, {}, AGORA)
    expect(sel?.agent).toBe("codex")
    expect(sel?.window.usedPercent).toBe(30)
  })

  it("sem conversa ativa: pior global (comportamento anterior preservado)", () => {
    const sel = pillWindow(
      null,
      { "claude-code": SNAP_CLAUDE, codex: SNAP_CODEX },
      {},
      AGORA,
    )
    expect(sel?.agent).toBe("codex")
  })

  it("snapshot stale do agent ativo não conta: cai pro global vivo", () => {
    const depois = SNAP_CLAUDE.fetchedAt + STALE_MS + 1
    const codexFresco = { ...SNAP_CODEX, fetchedAt: depois }
    const sel = pillWindow(
      "claude-code",
      { "claude-code": SNAP_CLAUDE, codex: codexFresco },
      {},
      depois,
    )
    expect(sel?.agent).toBe("codex")
  })

  it("ninguém medido: null (a pill some ou mostra a falha, nunca inventa)", () => {
    expect(pillWindow("claude-code", {}, {}, AGORA)).toBeNull()
  })
})

describe("nomeação do provider na pill fechada", () => {
  it("usa o shortLabel do registry (nunca um percentual anônimo)", () => {
    expect(usagePillLabel("claude-code")).toBe("Claude")
    expect(usagePillLabel("codex")).toBe("Codex")
  })

  it("id desconhecido degrada pro próprio id (fail-open no render)", () => {
    expect(usagePillLabel("motor-inventado")).toBe("motor-inventado")
  })
})

describe("paleta e formatação", () => {
  it("barra cinza até 60, âmbar 60 a 80, vermelha 80+", () => {
    expect(usageTone(0)).toBe("ok")
    expect(usageTone(USAGE_WARN_PCT - 0.1)).toBe("ok")
    expect(usageTone(USAGE_WARN_PCT)).toBe("warn")
    expect(usageTone(USAGE_DANGER_PCT - 0.1)).toBe("warn")
    expect(usageTone(USAGE_DANGER_PCT)).toBe("danger")
    expect(usageTone(100)).toBe("danger")
  })

  it("float sujo do CLI vira percentual inteiro", () => {
    expect(fmtPct(28.999999999999996)).toBe("29%")
    expect(fmtPct(23)).toBe("23%")
  })

  it("reset formatado a partir do epoch em segundos da fixture", () => {
    // fixture 5h do claude: 1786557000s - AGORA = 230min → "3h 50min"
    expect(fmtResetIn(1_786_557_000, AGORA)).toBe("reseta em 3h 50min")
    // reset já passado/ausente: omite, sem contagem inventada
    expect(fmtResetIn(1_786_543_100, AGORA)).toBeNull()
    expect(fmtResetIn(null, AGORA)).toBeNull()
    // janela de 7 dias (fixture codex): dias + horas
    expect(fmtResetIn(1_787_056_559, AGORA)).toBe("reseta em 5d 22h")
  })

  it("idade do dado na cara (procedência temporal)", () => {
    expect(fmtAge(AGORA - 10_000, AGORA)).toBe("agora")
    expect(fmtAge(SNAP_CLAUDE.fetchedAt, AGORA)).toBe("de 3min atrás")
    expect(fmtAge(AGORA - 2 * 60 * 60_000, AGORA)).toBe("de 2h atrás")
  })
})

describe("quem entra no poll (duePollAgents)", () => {
  it("só motor de fonte rpc, instalado e logado", () => {
    const detected = {
      "claude-code": probe(), // statusline (push): nunca entra no poll
      codex: probe(),
      agy: probe(), // sem fonte no registry
    }
    expect(duePollAgents(true, detected, AGORA)).toEqual(["codex"])
  })

  it("medidor desligado = ninguém (o toggle esconde o mecanismo inteiro)", () => {
    expect(duePollAgents(false, { codex: probe() }, AGORA)).toEqual([])
  })

  it("CLI deslogada ou nunca detectada não gera spawn", () => {
    expect(
      duePollAgents(true, { codex: probe({ auth: "missing" }) }, AGORA),
    ).toEqual([])
    expect(duePollAgents(true, {}, AGORA)).toEqual([])
    expect(
      duePollAgents(true, { codex: probe({ installed: false }) }, AGORA),
    ).toEqual([])
  })

  it("respeita o delay da política e o probe em voo", () => {
    const detected = { codex: probe() }
    markPollAttempt("codex", AGORA)
    // em voo: nunca re-dispara
    expect(duePollAgents(true, detected, AGORA + POLL_MS * 2)).toEqual([])
    recordPollResult("codex", true, null, AGORA + 1_000)
    // sucesso: só depois da cadência cheia
    expect(duePollAgents(true, detected, AGORA + POLL_MS - 1)).toEqual([])
    expect(duePollAgents(true, detected, AGORA + POLL_MS)).toEqual(["codex"])
  })

  it("falha transiente re-tenta no backoff curto, não na cadência cheia", () => {
    const detected = { codex: probe() }
    markPollAttempt("codex", AGORA)
    recordPollResult("codex", false, "spawn", AGORA + 1_000)
    expect(duePollAgents(true, detected, AGORA + POLL_FLOOR_MS - 1)).toEqual([])
    expect(duePollAgents(true, detected, AGORA + POLL_FLOOR_MS)).toEqual([
      "codex",
    ])
  })
})

describe("registro de falha e store", () => {
  it("erro estruturado do backend preserva o kind; forma estranha degrada", () => {
    expect(parseFetchError({ kind: "timeout", message: "20s" })).toEqual({
      kind: "timeout",
      message: "20s",
    })
    expect(parseFetchError("connection refused").kind).toBe("protocol")
  })

  it("episódio de falha: since fica na 1ª falha, streak cresce", () => {
    const s = useUsage.getState()
    s.recordFailure("codex", "spawn", "no such file", AGORA)
    s.recordFailure("codex", "timeout", "20s", AGORA + 60_000)
    const f = useUsage.getState().failures.codex
    expect(f.since).toBe(AGORA) // "falhando desde X" honesto
    expect(f.streak).toBe(2)
    expect(f.kind).toBe("timeout") // o tipo corrente é o da última
  })

  it("snapshot novo fecha o episódio de falha do agent", () => {
    const s = useUsage.getState()
    s.recordFailure("codex", "spawn", "x", AGORA)
    s.ingest(SNAP_CODEX)
    expect(useUsage.getState().failures.codex).toBeUndefined()
    expect(useUsage.getState().byAgent.codex).toEqual(SNAP_CODEX)
  })
})
