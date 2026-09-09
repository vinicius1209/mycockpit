// Testes do medidor de janela de uso (lado TS): política de poll do Orca
// copiada como REGRA, staleness honesta e agregação da pill. As fixtures são
// o ESPELHO exato do que o Rust emite a partir dos payloads REAIS capturados
// em 12/08/2026 (ADR-016: os valores 23/29/30%, resets e janelas vêm da
// statusline do claude 2.1.220 e do account/rateLimits/read do codex 0.146
// desta máquina — ver usage_window.rs; os 4/37/58% da conta vêm do
// GET /api/oauth/usage real — ver claude_usage.rs).

import { beforeEach, describe, expect, it } from "vitest"
import { agentDef } from "@/lib/agents"
import type { AgentProbe } from "@/lib/detect"
import {
  POLL_FLOOR_MS,
  POLL_MS,
  USAGE_POLL_CHOICES,
  pollCadenceMs,
  STALE_MS,
  STALE_RATE_LIMITED_MS,
  USAGE_DANGER_PCT,
  USAGE_WARN_PCT,
  _resetUsagePollState,
  duePollAgents,
  fmtAge,
  fmtPct,
  fmtResetAbsolute,
  fmtResetIn,
  markPollAttempt,
  nextPollDelayMs,
  failureLabel,
  parseFetchError,
  pillWindow,
  recordPollResult,
  snapshotUsable,
  sourceLabel,
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

/** Snapshot como o Rust emite pra resposta REAL da CONTA do claude (a fonte
 *  que fez o medidor existir pro claude: a statusline não roda em headless).
 *  Valores/resets são os do capture de 12/08/2026, incluindo o teto POR
 *  MODELO, que só a conta reporta. */
const SNAP_CLAUDE_OAUTH: UsageSnapshot = {
  agent: "claude-code",
  source: "oauth",
  windows: [
    { id: "5h", label: "5 h", usedPercent: 4, resetsAt: 1_786_575_000, windowMinutes: 300 },
    { id: "7d", label: "7 dias", usedPercent: 37, resetsAt: 1_786_996_800, windowMinutes: 10_080 },
    { id: "7d:fable", label: "7 dias · Fable", usedPercent: 58, resetsAt: 1_786_996_800, windowMinutes: 10_080 },
  ],
  planType: "max",
  fetchedAt: 1_786_543_150_000,
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

  it("sem login também não acelera (quem resolve é o usuário, não o retry)", () => {
    expect(nextPollDelayMs(1, "auth")).toBe(POLL_MS)
    expect(nextPollDelayMs(5, "auth")).toBe(POLL_MS)
  })
})

describe("cadência escolhida pela pessoa", () => {
  it("os três degraus viram milissegundos", () => {
    expect(USAGE_POLL_CHOICES).toEqual([5, 10, 15])
    expect(pollCadenceMs(5)).toBe(5 * 60_000)
    expect(pollCadenceMs(10)).toBe(10 * 60_000)
    expect(pollCadenceMs(15)).toBe(POLL_MS)
  })

  it("valor fora do conjunto cai no padrão, nunca vira poll em laço", () => {
    // Setting persistido é dado de FORA (arquivo à mão, versão antiga): sem
    // esta régua, um `0` gravado viraria martelada contra o provider.
    for (const sujo of [0, 1, -5, 999, Number.NaN]) {
      expect(pollCadenceMs(sujo)).toBe(POLL_MS)
    }
    expect(pollCadenceMs(null)).toBe(POLL_MS)
    expect(pollCadenceMs(undefined)).toBe(POLL_MS)
  })

  it("escolher 5 min encurta o caminho FELIZ e o teto do backoff", () => {
    const cinco = pollCadenceMs(5)
    expect(nextPollDelayMs(0, null, cinco)).toBe(cinco)
    expect(nextPollDelayMs(100, "spawn", cinco)).toBe(cinco)
  })

  it("…mas não move o piso: provider recusando não vira martelada", () => {
    // O backoff transiente continua começando em 30s, e 429/auth continuam
    // esperando a cadência inteira. Escolher 5 min não é licença pra insistir.
    const cinco = pollCadenceMs(5)
    expect(nextPollDelayMs(1, "spawn", cinco)).toBe(POLL_FLOOR_MS)
    expect(nextPollDelayMs(1, "rate-limited", cinco)).toBe(cinco)
    expect(nextPollDelayMs(1, "auth", cinco)).toBe(cinco)
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

  it("agent ativo sem medição NÃO pega o número do vizinho emprestado", () => {
    // Era fallback pro pior global; virou null no build 201. Nomear o dono não
    // bastava: a faixa é lida como estado DESTA janela.
    expect(pillWindow("claude-code", { codex: SNAP_CODEX }, {}, AGORA)).toBeNull()
  })

  it("motor SEM fonte de janela no registry não exibe a janela de outro", () => {
    // O bug relatado: conversa do Antigravity mostrando `Claude 59%` na faixa.
    // O COMPORTAMENTO travado aqui é "sem fonte, vizinho não empresta", e a
    // pergunta é por CAPABILITY (usageWindow), nunca pelo nome do motor.
    // O caso nasceu com o `agy` de cobaia porque ele era o motor sem fonte da
    // época; em 16/08/2026 ele ganhou a fonte "print" e a cobaia passou pro
    // `opencode` (ainda não integrado). A regra é a mesma, o exemplo é que
    // mudou — se ela dependesse do nome do motor, este teste não teria
    // sobrevivido à troca.
    expect(agentDef("opencode")?.usageWindow).toBeNull() // trava a premissa
    const sel = pillWindow(
      "opencode",
      { "claude-code": SNAP_CLAUDE, codex: SNAP_CODEX },
      {},
      AGORA,
    )
    expect(sel).toBeNull()
  })

  it("sem conversa ativa: pior global (aí não há dono a respeitar)", () => {
    const sel = pillWindow(
      null,
      { "claude-code": SNAP_CLAUDE, codex: SNAP_CODEX },
      {},
      AGORA,
    )
    expect(sel?.agent).toBe("codex")
  })

  it("snapshot stale do agent ativo some, não vira o global vivo", () => {
    const depois = SNAP_CLAUDE.fetchedAt + STALE_MS + 1
    const codexFresco = { ...SNAP_CODEX, fetchedAt: depois }
    const sel = pillWindow(
      "claude-code",
      { "claude-code": SNAP_CLAUDE, codex: codexFresco },
      {},
      depois,
    )
    expect(sel).toBeNull()
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
  it("todo motor com dialeto de poll, instalado e logado", () => {
    const detected = {
      "claude-code": probe(), // usagePoll "oauth": a conta responde sempre
      codex: probe(), // usagePoll "rpc": app-server read-only
      agy: probe(), // usagePoll "print": `-p "/usage"` headless, custo zero
      opencode: probe(), // sem fonte no registry: nada a perguntar
    }
    // O Claude entra via OAuth: a statusline push não dispara nas conversas
    // headless do app. O agy entrou em 16/08/2026 (antes era `null` porque a
    // única fonte auditada era o /credits, saldo sem janela).
    expect(duePollAgents(true, detected, AGORA)).toEqual([
      "claude-code",
      "codex",
      "agy",
    ])
  })

  it("medidor desligado = ninguém (o toggle esconde o mecanismo inteiro)", () => {
    expect(duePollAgents(false, { codex: probe() }, AGORA)).toEqual([])
  })

  it("a cadência escolhida chega até aqui, e é ela que solta o próximo poll", () => {
    const detected = { codex: probe() }
    const cinco = pollCadenceMs(5)
    markPollAttempt("codex", AGORA)
    recordPollResult("codex", true, null, AGORA)
    // Na cadência padrão ainda não é hora; na de 5 min, já é.
    expect(duePollAgents(true, detected, AGORA + cinco)).toEqual([])
    expect(duePollAgents(true, detected, AGORA + cinco, cinco)).toEqual(["codex"])
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

describe("procedência e falha legíveis", () => {
  it("cada fonte se apresenta em pt-BR, sem jargão de protocolo", () => {
    expect(sourceLabel("oauth")).toBe("leitura da conta")
    expect(sourceLabel("rpc")).toBe("leitura local")
    expect(sourceLabel("print")).toBe("consulta ao CLI")
    expect(sourceLabel("statusline")).toBe("statusline")
    // fonte nova degrada pra ela mesma (fail-open no render)
    expect(sourceLabel("telepatia")).toBe("telepatia")
  })

  it("falha de credencial vira gesto ('reautentique'), nunca erro cru", () => {
    expect(failureLabel("auth")).toBe("reautentique o CLI")
    expect(failureLabel("rate-limited")).toBe(
      "consultas limitadas, tentando mais tarde",
    )
    expect(failureLabel("timeout")).toBe("sem resposta a tempo")
    expect(failureLabel("kind-que-ainda-nao-existe")).toBe(
      "kind-que-ainda-nao-existe",
    )
  })

  it("o snapshot da conta carrega procedência e plano do próprio provider", () => {
    expect(sourceLabel(SNAP_CLAUDE_OAUTH.source)).toBe("leitura da conta")
    expect(SNAP_CLAUDE_OAUTH.planType).toBe("max")
  })
})

describe("teto por modelo (só a conta reporta)", () => {
  it("a janela mais queimada do claude é a do modelo, não a do plano", () => {
    const sel = pillWindow(
      "claude-code",
      { "claude-code": SNAP_CLAUDE_OAUTH, codex: SNAP_CODEX },
      {},
      AGORA,
    )
    // 58% do Fable > 37% da semana > 30% do codex: some essa janela e o
    // medidor erraria por 21 pontos.
    expect(sel?.agent).toBe("claude-code")
    expect(sel?.window.id).toBe("7d:fable")
    expect(sel?.window.usedPercent).toBe(58)
  })

  it("com o claude medido, o pior global deixa de ser o codex", () => {
    const worst = worstWindow(
      { "claude-code": SNAP_CLAUDE_OAUTH, codex: SNAP_CODEX },
      {},
      AGORA,
    )
    expect(worst?.agent).toBe("claude-code")
    expect(worst?.window.label).toBe("7 dias · Fable")
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

describe("horário absoluto do reset", () => {
  const HOJE = new Date(2026, 7, 16, 14, 0, 0).getTime()

  it("reset HOJE diz só a hora", () => {
    const às2150 = new Date(2026, 7, 16, 21, 50, 0).getTime() / 1000
    expect(fmtResetAbsolute(às2150, HOJE)).toBe("às 21:50")
  })

  it("reset em OUTRO dia carrega o dia — 'às 21:50' pelado afirmaria hoje", () => {
    // A janela de 7 dias reseta a dias de distância: era o caso comum, e o
    // formato antigo dizia "às 21:50" como se fosse hoje.
    const em6dias = new Date(2026, 7, 22, 21, 50, 0).getTime() / 1000
    expect(fmtResetAbsolute(em6dias, HOJE)).toBe("dia 22, 21:50")
  })

  it("sem reset conhecido não inventa horário", () => {
    expect(fmtResetAbsolute(null, HOJE)).toBeNull()
  })
})
