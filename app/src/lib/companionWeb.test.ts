// Fundação C1 do Companion Web: o núcleo puro do cliente do celular
// (src-tauri/companion/core.js) importado DIRETO — o arquivo testado é o
// mesmo servido pelo binário (GET /core.js), nada de implementação gêmea.
// O core é UMD: o import por efeito colateral publica o global CompanionCore
// (tipado por src-tauri/companion/core.d.ts).
import { describe, expect, it } from "vitest"
import "../../src-tauri/companion/core.js"

const core = globalThis.CompanionCore

describe("rotas do companion (history API via hash)", () => {
  it("hash vazio, raiz ou lixo cai no briefing sem crashar", () => {
    expect(core.parseRoute("")).toEqual({ screen: "brief" })
    expect(core.parseRoute("#/")).toEqual({ screen: "brief" })
    expect(core.parseRoute("#qualquer-coisa")).toEqual({ screen: "brief" })
    expect(core.parseRoute("#/desconhecida/x")).toEqual({ screen: "brief" })
    expect(core.parseRoute("#/chat/so-projeto")).toEqual({ screen: "brief" })
  })

  it("fragment de token do pareamento nunca vira rota", () => {
    expect(core.parseRoute("#token=aabbccddeeff0011")).toEqual({
      screen: "brief",
    })
  })

  it("ida e volta tela → hash → tela preserva projeto, agent e conversa", () => {
    const agents: CompanionWebRoute = { screen: "agents", projectId: "p1" }
    expect(core.parseRoute(core.routeHash(agents))).toEqual(agents)

    const mesa: CompanionWebRoute = {
      screen: "chat",
      projectId: "p1",
      agent: "claude-code",
    }
    expect(core.parseRoute(core.routeHash(mesa))).toEqual(mesa)

    const explicita: CompanionWebRoute = {
      screen: "chat",
      projectId: "p2",
      agent: "codex",
      convId: "abc-123",
    }
    expect(core.parseRoute(core.routeHash(explicita))).toEqual(explicita)
  })

  it("segmentos com caracteres especiais sobrevivem ao encode/decode", () => {
    const r: CompanionWebRoute = {
      screen: "agents",
      projectId: "meu projeto/estranho#1",
    }
    const hash = core.routeHash(r)
    expect(hash.startsWith("#/agents/")).toBe(true)
    expect(core.parseRoute(hash)).toEqual(r)
  })

  it("percent-encoding inválido no hash não crasha, usa o segmento cru", () => {
    expect(core.parseRoute("#/agents/%E0%")).toEqual({
      screen: "agents",
      projectId: "%E0%",
    })
  })

  it("rota sem os campos obrigatórios vira a raiz", () => {
    expect(core.routeHash({ screen: "agents" })).toBe("#/")
    expect(core.routeHash({ screen: "chat", projectId: "p1" })).toBe("#/")
    expect(core.routeHash(null)).toBe("#/")
  })
})

describe("visto há (carimbo honesto do snapshot)", () => {
  const now = 1_700_000_000_000
  it("sem timestamp nunca inventa idade", () => {
    expect(core.seenAgo(now, null)).toBe("")
    expect(core.seenAgo(now, undefined)).toBe("")
    expect(core.seenAgo(now, 0)).toBe("")
    expect(core.seenAgo(now, Number.NaN)).toBe("")
  })
  it("menos de um minuto é visto agora", () => {
    expect(core.seenAgo(now, now - 5_000)).toBe("visto agora")
  })
  it("minutos, horas e dias em pt-BR", () => {
    expect(core.seenAgo(now, now - 3 * 60_000)).toBe("visto há 3 min")
    expect(core.seenAgo(now, now - 2 * 3_600_000)).toBe("visto há 2 h")
    expect(core.seenAgo(now, now - 3 * 86_400_000)).toBe("visto há 3 d")
  })
  it("relógio andando pra trás não vira idade negativa", () => {
    expect(core.seenAgo(now, now + 60_000)).toBe("visto agora")
  })
})

describe("banner de offline (dado velho carimbado desde o boot)", () => {
  const base: CompanionWebOfflineInput = {
    mock: false,
    token: true,
    screen: "brief",
    conn: "connecting",
    connStatus: "connecting",
    snapStale: false,
  }

  it("boot offline com snapshot restaurado do cache carimba JÁ, antes da primeira queda", () => {
    // Mac desligado sem RST: status ainda é connecting, mas o dado na tela é
    // de ontem — o banner não espera o primeiro timeout de rede.
    expect(core.offlineBanner({ ...base, snapStale: true })).toBe(true)
  })

  it("primeiro load sem dado nenhum não flasha banner durante o handshake", () => {
    expect(core.offlineBanner(base)).toBe(false)
  })

  it("queda real (reconnecting) mostra o banner mesmo sem dado velho", () => {
    expect(
      core.offlineBanner({ ...base, connStatus: "reconnecting" }),
    ).toBe(true)
  })

  it("conectado nunca mostra banner, mesmo logo após restaurar cache", () => {
    expect(
      core.offlineBanner({ ...base, conn: "on", snapStale: true }),
    ).toBe(false)
  })

  it("sem token, em mock ou na tela de pareamento o banner não existe", () => {
    expect(core.offlineBanner({ ...base, token: false, snapStale: true })).toBe(
      false,
    )
    expect(core.offlineBanner({ ...base, mock: true, snapStale: true })).toBe(
      false,
    )
    expect(
      core.offlineBanner({ ...base, screen: "pair", snapStale: true }),
    ).toBe(false)
    expect(core.offlineBanner(null)).toBe(false)
  })
})

describe("máquina de reconexão (backoff com teto)", () => {
  it("backoff dobra a cada tentativa e trava em 15s", () => {
    expect(core.backoffDelay(0)).toBe(1_000)
    expect(core.backoffDelay(1)).toBe(2_000)
    expect(core.backoffDelay(2)).toBe(4_000)
    expect(core.backoffDelay(3)).toBe(8_000)
    expect(core.backoffDelay(4)).toBe(15_000)
    expect(core.backoffDelay(50)).toBe(15_000)
  })

  it("primeira conexão é connecting; queda vira reconnecting com retry", () => {
    let st = core.connReduce(null, "connect")
    expect(st.status).toBe("connecting")
    st = core.connReduce(st, "down")
    expect(st.status).toBe("reconnecting")
    expect(st.attempt).toBe(1)
    expect(st.retryInMs).toBe(1_000)
  })

  it("quedas seguidas crescem o backoff até o teto", () => {
    let st = core.connReduce(null, "connect")
    const delays: (number | null)[] = []
    for (let i = 0; i < 6; i++) {
      st = core.connReduce(st, "down")
      delays.push(st.retryInMs)
      st = core.connReduce(st, "connect")
      expect(st.status).toBe("reconnecting") // retry visível, não silêncio
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000])
  })

  it("abrir zera as tentativas: a próxima queda recomeça do backoff curto", () => {
    let st = core.connReduce(null, "connect")
    st = core.connReduce(st, "down")
    st = core.connReduce(st, "down")
    st = core.connReduce(st, "open")
    expect(st).toEqual({ status: "on", attempt: 0, retryInMs: null })
    st = core.connReduce(st, "down")
    expect(st.retryInMs).toBe(1_000)
  })

  it("evento desconhecido não muda nada (fail-open)", () => {
    const st = core.connReduce(null, "connect")
    expect(core.connReduce(st, "meteoro")).toEqual(st)
  })

  it("rótulos pt-BR por estado", () => {
    expect(core.connLabel({ status: "on", attempt: 0, retryInMs: null })).toBe(
      "conectado",
    )
    expect(
      core.connLabel({ status: "connecting", attempt: 0, retryInMs: null }),
    ).toBe("conectando…")
    expect(
      core.connLabel({ status: "reconnecting", attempt: 2, retryInMs: 2000 }),
    ).toBe("reconectando…")
  })
})

// ───────────────────────────────────────────────────────────── C2 — Ações

describe("rota de lançar tarefa (C2)", () => {
  it("ida e volta preserva a tela e o projeto pré-escolhido", () => {
    const semProjeto: CompanionWebRoute = { screen: "launch" }
    expect(core.routeHash(semProjeto)).toBe("#/launch")
    expect(core.parseRoute("#/launch")).toEqual(semProjeto)

    const comProjeto: CompanionWebRoute = { screen: "launch", projectId: "p1" }
    expect(core.parseRoute(core.routeHash(comProjeto))).toEqual(comProjeto)
  })

  it("projeto com caracteres especiais sobrevive ao encode/decode", () => {
    const r: CompanionWebRoute = { screen: "launch", projectId: "meu proj#2" }
    expect(core.parseRoute(core.routeHash(r))).toEqual(r)
  })
})

describe("parar turno com semântica honesta (stopDisposition)", () => {
  it("turno rodando pode parar", () => {
    expect(core.stopDisposition({ finalizing: false })).toEqual({
      can: true,
      label: "Parar",
      reason: null,
    })
  })

  it("turno FINALIZANDO não é interrompível, com o motivo na cara", () => {
    const d = core.stopDisposition({ finalizing: true })
    expect(d.can).toBe(false)
    expect(d.reason).toContain("não dá mais para interromper")
  })

  it("item torto ou ausente é fail-open: deixa parar (o Mac é a verdade final)", () => {
    expect(core.stopDisposition(null).can).toBe(true)
    expect(core.stopDisposition(undefined).can).toBe(true)
  })
})

describe("id de ação idempotente (makeActionId)", () => {
  it("gera 32 hex e é determinístico dado o rand injetado", () => {
    const a = core.makeActionId(() => 0.5)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(core.makeActionId(() => 0.5)).toBe(a)
    // rand diferente → id diferente (um id POR gesto)
    expect(core.makeActionId(() => 0.1)).not.toBe(a)
  })

  it("rand torto nunca produz char inválido", () => {
    expect(core.makeActionId(() => Number.NaN)).toMatch(/^[0-9a-f]{32}$/)
    expect(core.makeActionId(() => 99)).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe("resposta de pergunta com opções (buildQuestionAnswer)", () => {
  // fixture com o shape REAL do snapshot (CompanionQuestion ← AskUserQuestion)
  const choices: CompanionWebChoice[] = [
    {
      header: "Cache",
      question: "Qual estratégia de cache prefere?",
      multiSelect: false,
      options: [
        { label: "TTL curto", description: "30s" },
        { label: "Invalidação por evento", description: "mais código" },
      ],
    },
    {
      header: "Escopo",
      question: "Onde aplicar?",
      multiSelect: true,
      options: [
        { label: "API", description: "" },
        { label: "Front", description: "" },
      ],
    },
  ]

  it("monta answers com header + labels marcados, no shape do desktop", () => {
    const out = core.buildQuestionAnswer(choices, [
      { selected: ["TTL curto"] },
      { selected: ["API", "Front"] },
    ])
    expect(out).toEqual({
      answers: [
        { header: "Cache", selected: ["TTL curto"] },
        { header: "Escopo", selected: ["API", "Front"] },
      ],
    })
  })

  it("texto livre (Outro) entra como seleção, depois dos labels", () => {
    const out = core.buildQuestionAnswer(choices, [
      { selected: [], other: "  redis com TTL de 5 min  " },
      { selected: ["API"], other: "e o worker também" },
    ])
    expect(out?.answers[0].selected).toEqual(["redis com TTL de 5 min"])
    expect(out?.answers[1].selected).toEqual(["API", "e o worker também"])
  })

  it("single-select nunca viaja com mais de um label (o excedente cai)", () => {
    const out = core.buildQuestionAnswer(choices, [
      { selected: ["TTL curto", "Invalidação por evento"] },
      { selected: ["API"] },
    ])
    expect(out?.answers[0].selected).toEqual(["TTL curto"])
  })

  it("pergunta sem NADA marcado nem digitado = incompleta: null (nunca resposta muda)", () => {
    expect(
      core.buildQuestionAnswer(choices, [{ selected: ["TTL curto"] }, {}]),
    ).toBeNull()
    expect(core.buildQuestionAnswer(choices, null)).toBeNull()
  })

  it("entrada torta é fail-closed: sem perguntas não há payload", () => {
    expect(core.buildQuestionAnswer([], [])).toBeNull()
    expect(core.buildQuestionAnswer(null, [])).toBeNull()
  })
})
